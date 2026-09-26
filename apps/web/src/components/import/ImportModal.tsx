import React, { useState, useEffect } from 'react'
import {
  X,
  FileSpreadsheet,
  FolderArchive,
  Upload,
  Lock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  FolderOpen,
  Sparkles,
} from 'lucide-react'
import { DetectedImportFile, ImportSummary } from '../../types/knx'
import { fetchLocalImportFiles, importEtsCsv, importKnxproj } from '../../services/api'

interface ImportModalProps {
  isOpen: boolean
  onClose: () => void
  onImportSuccess: () => void
}

export const ImportModal: React.FC<ImportModalProps> = ({
  isOpen,
  onClose,
  onImportSuccess,
}) => {
  const [activeTab, setActiveTab] = useState<'local' | 'upload'>('local')
  const [localFiles, setLocalFiles] = useState<DetectedImportFile[]>([])
  const [selectedFile, setSelectedFile] = useState<DetectedImportFile | null>(null)
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [password, setPassword] = useState('')
  const [projectName, setProjectName] = useState('KNX Projekt')
  const [loading, setLoading] = useState(false)
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<ImportSummary | null>(null)

  useEffect(() => {
    if (isOpen) {
      setError(null)
      setSummary(null)
      setLoadingFiles(true)
      fetchLocalImportFiles()
        .then((files) => {
          setLocalFiles(files)
          // Default to first detected knxproj or CSV file
          const preferred =
            files.find((f) => f.name.endsWith('.knxproj') || f.name.includes('KNX-GA-Tool')) ||
            files[0]
          if (preferred) {
            setSelectedFile(preferred)
          }
        })
        .finally(() => setLoadingFiles(false))
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleImport = async () => {
    setError(null)
    setSummary(null)
    setLoading(true)

    try {
      let result: ImportSummary

      if (activeTab === 'local') {
        if (!selectedFile) {
          throw new Error('Bitte wähle eine Datei zum Importieren aus.')
        }

        if (selectedFile.file_type === 'csv') {
          result = await importEtsCsv({
            filePath: selectedFile.path,
            projectName: projectName.trim() || undefined,
          })
        } else {
          result = await importKnxproj({
            filePath: selectedFile.path,
            password: password.trim() || undefined,
            projectName: projectName.trim() || undefined,
          })
        }
      } else {
        if (!uploadedFile) {
          throw new Error('Bitte wähle eine Datei zum Hochladen aus.')
        }

        const ext = uploadedFile.name.split('.').pop()?.toLowerCase()
        if (ext === 'csv') {
          const text = await uploadedFile.text()
          result = await importEtsCsv({
            content: text,
            projectName: projectName.trim() || uploadedFile.name.replace(/\.[^/.]+$/, ''),
          })
        } else if (ext === 'knxproj') {
          const arrayBuffer = await uploadedFile.arrayBuffer()
          const bytes = new Uint8Array(arrayBuffer)
          let binary = ''
          for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i])
          }
          const base64 = btoa(binary)

          result = await importKnxproj({
            contentBase64: base64,
            password: password.trim() || undefined,
            projectName: projectName.trim() || uploadedFile.name.replace(/\.[^/.]+$/, ''),
          })
        } else {
          throw new Error('Unterstützt werden nur .knxproj und .csv Dateien.')
        }
      }

      setSummary(result)
      onImportSuccess()
    } catch (err: any) {
      console.error('Import error:', err)
      setError(err.message || 'Import fehlgeschlagen.')
    } finally {
      setLoading(false)
    }
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-2xl w-full max-w-2xl flex flex-col overflow-hidden max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-sky-500/10 text-sky-400 border border-sky-500/20">
              <FolderOpen className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                ETS Projekt & Gruppenadressen importieren
                <span className="text-[10px] font-normal bg-sky-500/20 text-sky-300 px-2 py-0.5 rounded-full">
                  .knxproj & .csv
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Liest Gruppenadressen, Stockwerke, Räume und Klemmen direkt aus deiner ETS-Konfiguration ein.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* Tabs */}
          <div className="flex border-b border-slate-800 gap-6">
            <button
              onClick={() => setActiveTab('local')}
              className={`pb-2 text-xs font-semibold flex items-center gap-2 transition-colors border-b-2 -mb-px ${
                activeTab === 'local'
                  ? 'border-sky-500 text-sky-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <FolderArchive className="w-4 h-4" />
              Gefundene lokale Dateien ({localFiles.length})
            </button>
            <button
              onClick={() => setActiveTab('upload')}
              className={`pb-2 text-xs font-semibold flex items-center gap-2 transition-colors border-b-2 -mb-px ${
                activeTab === 'upload'
                  ? 'border-sky-500 text-sky-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Upload className="w-4 h-4" />
              Manuell hochladen (.knxproj / .csv)
            </button>
          </div>

          {/* Tab 1: Local files */}
          {activeTab === 'local' && (
            <div className="space-y-3">
              <div className="text-xs text-slate-300 font-medium">
                Auf diesem PC erkannte ETS-Dateien:
              </div>

              {loadingFiles ? (
                <div className="py-8 flex items-center justify-center gap-2 text-xs text-slate-400">
                  <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
                  Suche nach ETS-Dateien in Standard-Verzeichnissen...
                </div>
              ) : localFiles.length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-lg">
                  Keine lokalen .knxproj oder .csv Dateien automatisch gefunden. Nutze den Tab &quot;Manuell hochladen&quot;.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2 max-h-56 overflow-y-auto pr-1">
                  {localFiles.map((file) => {
                    const isSelected = selectedFile?.path === file.path
                    const isKnxproj = file.file_type === 'knxproj'

                    return (
                      <div
                        key={file.path}
                        onClick={() => setSelectedFile(file)}
                        className={`p-3 rounded-lg border text-left cursor-pointer transition-all flex items-start justify-between gap-3 ${
                          isSelected
                            ? 'bg-sky-950/40 border-sky-500/60 ring-1 ring-sky-500/30'
                            : 'bg-slate-800/40 border-slate-800 hover:bg-slate-800/70 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-start gap-2.5 min-w-0">
                          <div
                            className={`p-1.5 rounded mt-0.5 ${
                              isKnxproj
                                ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            }`}
                          >
                            {isKnxproj ? (
                              <FolderArchive className="w-4 h-4" />
                            ) : (
                              <FileSpreadsheet className="w-4 h-4" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-slate-200 flex items-center gap-2">
                              <span className="truncate">{file.name}</span>
                              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 shrink-0">
                                {file.file_type.toUpperCase()}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-400 truncate mt-0.5">
                              {file.path}
                            </div>
                          </div>
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 shrink-0 mt-1">
                          {formatSize(file.size_bytes)}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Tab 2: Upload */}
          {activeTab === 'upload' && (
            <div className="space-y-3">
              <label
                htmlFor="knx-upload-input"
                className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer transition-colors ${
                  uploadedFile
                    ? 'border-sky-500/50 bg-sky-950/20'
                    : 'border-slate-800 hover:border-slate-700 bg-slate-950/40'
                }`}
              >
                <Upload className="w-8 h-8 text-slate-500 mb-2" />
                <span className="text-xs font-medium text-slate-200">
                  {uploadedFile ? uploadedFile.name : 'ETS Projekt (.knxproj) oder GA-Export (.csv) ablegen'}
                </span>
                <span className="text-[11px] text-slate-500 mt-1">
                  Klicken zum Auswählen oder Drag & Drop
                </span>
                <input
                  id="knx-upload-input"
                  type="file"
                  accept=".knxproj,.csv"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) setUploadedFile(f)
                  }}
                  className="hidden"
                />
              </label>
            </div>
          )}

          {/* Configuration Parameters */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-800/80">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Projektname im Konfigurator
              </label>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="Mein KNX Haus"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-sky-500"
              />
            </div>

            {/* Password (for encrypted knxproj) */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-slate-400" />
                  ETS-Projektpasswort (optional)
                </span>
                <span className="text-[10px] text-slate-500">Nur bei Schutz</span>
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Falls in ETS verschlüsselt..."
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-sky-500"
              />
            </div>
          </div>

          {/* Success Banner */}
          {summary && (
            <div className="p-4 rounded-lg bg-emerald-950/30 border border-emerald-500/30 flex items-start gap-3 text-emerald-400">
              <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
              <div className="text-xs space-y-1">
                <div className="font-semibold text-emerald-300">{summary.message}</div>
                <div className="text-emerald-400/80 flex flex-wrap gap-x-4 gap-y-1 text-[11px] pt-1">
                  <span>📍 {summary.group_address_count} Gruppenadressen</span>
                  <span>🏠 {summary.room_count} Räume</span>
                  <span>🏢 {summary.floor_count} Etagen</span>
                  <span>⚡ {summary.block_count} Funktionsblöcke</span>
                </div>
              </div>
            </div>
          )}

          {/* Error Banner */}
          {error && (
            <div className="p-4 rounded-lg bg-red-950/30 border border-red-500/30 flex items-start gap-3 text-red-400">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <div className="text-xs">
                <div className="font-semibold text-red-300">Import fehlgeschlagen</div>
                <div className="mt-0.5 text-red-400/90">{error}</div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/40 flex items-center justify-between">
          <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>Erstellt automatisch Raum-Tabs und verknüpft Live-Bustelegramme.</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-xs font-medium text-slate-300 transition-colors"
            >
              {summary ? 'Schließen' : 'Abbrechen'}
            </button>
            <button
              onClick={handleImport}
              disabled={loading || (activeTab === 'local' && !selectedFile) || (activeTab === 'upload' && !uploadedFile)}
              className="px-5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold flex items-center gap-2 shadow-lg shadow-sky-600/20 transition-all"
            >
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{summary ? 'Erneut importieren' : 'Projekt importieren'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
