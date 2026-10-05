import React, { useState, useEffect } from 'react'
import {
  FolderCog,
  X,
  HardDrive,
  FolderSync,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Save,
  HelpCircle,
  Bot,
  Copy,
  Check,
  Terminal,
  Sparkles,
  Key,
  ShieldCheck,
  Eye,
  EyeOff,
} from 'lucide-react'
import { StorageSettings } from '../../types/storage'
import { fetchStorageSettings, updateStorageSettings } from '../../services/api'
import { useTranslation } from '../../i18n/I18nContext'

interface StorageSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  onSettingsUpdated?: (settings: StorageSettings) => void
}

export const StorageSettingsModal: React.FC<StorageSettingsModalProps> = ({
  isOpen,
  onClose,
  onSettingsUpdated,
}) => {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<'storage' | 'mcp'>('storage')
  const [settings, setSettings] = useState<StorageSettings | null>(null)
  const [dataDir, setDataDir] = useState('')
  const [migrate, setMigrate] = useState(true)
  const [signingKey, setSigningKey] = useState('')
  const [showSigningKey, setShowSigningKey] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [copiedSnippet, setCopiedSnippet] = useState<string | null>(null)

  const loadSettings = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const s = await fetchStorageSettings()
      setSettings(s)
      setDataDir(s.data_dir)
      setSigningKey(s.signing_key || '')
    } catch (err: any) {
      setError(err?.message || 'Fehler beim Laden der Speicher-Einstellungen')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (isOpen) {
      loadSettings()
      setSuccessMsg(null)
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleSave = async () => {
    const trimmed = dataDir.trim()
    if (!trimmed) {
      setError('Der Verzeichnispfad darf nicht leer sein')
      return
    }

    setIsSaving(true)
    setError(null)
    setSuccessMsg(null)

    try {
      const keyToSend = signingKey === 'configured' ? undefined : (signingKey.trim() || null)
      const updated = await updateStorageSettings(trimmed, migrate, keyToSend)
      setSettings(updated)
      setDataDir(updated.data_dir)
      setSigningKey(updated.signing_key || '')
      setSuccessMsg('Einstellungen erfolgreich aktualisiert!')
      if (onSettingsUpdated) {
        onSettingsUpdated(updated)
      }
      setTimeout(() => {
        setSuccessMsg(null)
        onClose()
      }, 1500)
    } catch (err: any) {
      setError(err?.message || 'Fehler beim Speichern des neuen Pfads')
    } finally {
      setIsSaving(false)
    }
  }

  const mcpConfigJson = JSON.stringify(
    {
      mcpServers: {
        knx: {
          command: 'node',
          args: ['tools/knx-mcp/build/index.js'],
          env: {
            KONFIX_API_URL: 'http://localhost:8080/api',
          },
        },
      },
    },
    null,
    2
  )

  const handleCopyConfig = (label: string, text: string) => {
    navigator.clipboard.writeText(text)
    setCopiedSnippet(label)
    setTimeout(() => setCopiedSnippet(null), 2000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-100 max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/40 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-sky-900/30 text-white">
              {activeTab === 'storage' ? <FolderCog className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">
                {activeTab === 'storage' ? t('storage.settingsTitle') : 'Model Context Protocol (MCP) & KI'}
              </h2>
              <p className="text-xs text-slate-400">
                {activeTab === 'storage'
                  ? t('storage.settingsSubtitle')
                  : 'Schnittstelle für KI-Assistenten (Claude Desktop, Cursor, Gemini CLI)'}
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

        {/* Tab Switcher */}
        <div className="flex border-b border-slate-800 px-6 bg-slate-950/20 shrink-0">
          <button
            onClick={() => setActiveTab('storage')}
            className={`py-3 px-4 text-xs font-semibold border-b-2 flex items-center gap-2 transition-all ${
              activeTab === 'storage'
                ? 'border-sky-500 text-sky-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <FolderCog className="w-4 h-4" />
            <span>Dateisystem-Speicher</span>
          </button>
          <button
            onClick={() => setActiveTab('mcp')}
            className={`py-3 px-4 text-xs font-semibold border-b-2 flex items-center gap-2 transition-all ${
              activeTab === 'mcp'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Bot className="w-4 h-4" />
            <span>MCP & KI-Steuerung</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-emerald-500/20 text-emerald-300 font-mono">
              Live
            </span>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 overflow-y-auto">
          {activeTab === 'storage' ? (
            isLoading ? (
              <div className="py-8 flex flex-col items-center justify-center text-slate-500 space-y-2">
                <Loader2 className="w-6 h-6 animate-spin text-sky-400" />
                <span className="text-xs">{t('common.loading')}</span>
              </div>
            ) : (
              <>
                {/* Directory Input */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                    <HardDrive className="w-4 h-4 text-sky-400" />
                    <span>{t('storage.dataDirectory')}:</span>
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={dataDir}
                      onChange={(e) => setDataDir(e.target.value)}
                      placeholder="/home/user/.konfix"
                      className="w-full px-3.5 py-2.5 bg-slate-950/80 border border-slate-700 rounded-xl text-xs font-mono text-slate-100 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                    />
                  </div>
                  <p className="text-[11px] text-slate-400">
                    {t('storage.dataDirectoryHint')}
                  </p>
                </div>

                {/* Migration Checkbox */}
                <div className="p-3.5 bg-slate-950/50 border border-slate-800 rounded-xl space-y-2">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={migrate}
                      onChange={(e) => setMigrate(e.target.checked)}
                      className="mt-0.5 rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-sky-500 focus:ring-offset-slate-950 cursor-pointer"
                    />
                    <div>
                      <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                        <FolderSync className="w-3.5 h-3.5 text-emerald-400" />
                        <span>{t('storage.migrateProjects')}</span>
                      </span>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {t('storage.migrateProjectsDesc')}
                      </p>
                    </div>
                  </label>
                </div>

                {/* ETS Export Signing Key Section */}
                <div className="p-3.5 bg-slate-950/60 border border-slate-800 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                      <Key className="w-4 h-4 text-amber-400" />
                      <span>ETS-Projekt Signierschlüssel (Signing Key)</span>
                    </label>
                    <div className="flex items-center gap-2">
                      {signingKey.trim() ? (
                        <>
                          <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/20 text-emerald-300 font-medium flex items-center gap-1">
                            <ShieldCheck className="w-3 h-3 text-emerald-400" />
                            Schlüssel aktiv
                          </span>
                          <button
                            type="button"
                            onClick={() => setSigningKey('')}
                            className="px-2 py-0.5 rounded-full text-[10px] bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 transition-colors"
                            title="Signierschlüssel entfernen"
                          >
                            Entfernen
                          </button>
                        </>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] bg-slate-800 text-slate-400 font-medium">
                          Nicht hinterlegt
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="relative">
                    <input
                      type={showSigningKey ? 'text' : 'password'}
                      value={signingKey === 'configured' ? '' : signingKey}
                      onChange={(e) => setSigningKey(e.target.value)}
                      placeholder={signingKey === 'configured' ? '✓ RSA-Schlüssel ist hinterlegt. Neuen Schlüssel/Pfad eingeben zum Überschreiben...' : 'RSA Private Key (PEM / Base64) oder Dateipfad...'}
                      className="w-full pl-3.5 pr-10 py-2.5 bg-slate-950/80 border border-slate-700 rounded-xl text-xs font-mono text-slate-100 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSigningKey(!showSigningKey)}
                      className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-200"
                      title={showSigningKey ? 'Schlüssel verbergen' : 'Schlüssel anzeigen'}
                    >
                      {showSigningKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Wird beim <strong>.knxproj-Export</strong> verwendet, um die Projektdatei digital zu signieren (Integritäts- und Quellsignatur). Ermöglicht den reibungslosen Import in ETS 5 &amp; 6 ohne Signaturwarnung. Unterstützt RSA PEM (PKCS#1 / PKCS#8) sowie Base64-DER.
                  </p>
                </div>

                {/* Structure Explanation */}
                <div className="p-3.5 bg-slate-950/40 border border-slate-800/80 rounded-xl space-y-2 text-[11px] text-slate-400">
                  <div className="font-semibold text-slate-300 flex items-center gap-1.5">
                    <HelpCircle className="w-3.5 h-3.5 text-slate-400" />
                    <span>Ordnerstruktur in diesem Verzeichnis:</span>
                  </div>
                  <div className="font-mono text-[10px] space-y-1 pl-1 text-slate-400">
                    <div>📁 <strong>projects/</strong> — Gespeicherte KoNfiX-Projektdateien (*.konfix)</div>
                    <div>📁 <strong>views/</strong> — Gespeicherte Zoom-, Pan- und Raumanordnungen</div>
                    <div>📁 <strong>backups/</strong> — Automatische Sicherungskopien vor jedem Überschreiben</div>
                    <div>📄 <strong>settings.json</strong> — Aktive Projekte & Systemkonfiguration</div>
                    <div>💾 <strong>catalog.db</strong> — Schnelle SQLite-Gerätedatenbank für KNX-Hardware</div>
                  </div>
                </div>

                {/* Error Message */}
                {error && (
                  <div className="p-3 bg-red-950/40 border border-red-500/40 rounded-xl text-xs text-red-300 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
                    <span>{error}</span>
                  </div>
                )}

                {/* Success Message */}
                {successMsg && (
                  <div className="p-3 bg-emerald-950/40 border border-emerald-500/40 rounded-xl text-xs text-emerald-300 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                    <span>{successMsg}</span>
                  </div>
                )}
              </>
            )
          ) : (
            /* MCP Server & AI Tab */
            <div className="space-y-4">
              <div className="p-3.5 bg-indigo-950/30 border border-indigo-500/30 rounded-xl flex items-start gap-3">
                <Sparkles className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
                <div className="text-xs space-y-1">
                  <div className="font-bold text-indigo-200">Native KI-Steuerung via Model Context Protocol</div>
                  <div className="text-slate-300 leading-relaxed">
                    KoNfiX stellt einen nativen MCP-Server bereit. LLMs können Live-Telegrame senden, Gruppenadressen
                    abfragen, KNX-Geräte inspizieren und Parameter automatisch anpassen.
                  </div>
                </div>
              </div>

              {/* Server Tools Overview */}
              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-sky-400" />
                  <span>Bereitgestellte MCP-Tools (9 Funktionen):</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="p-2 bg-slate-950/60 border border-slate-800 rounded-lg">
                    <code className="text-sky-300 font-bold">knx_send_telegram</code>
                    <div className="text-slate-400 text-[10px] mt-0.5">Schalten, Dimmen, Jalousie (auch per Name)</div>
                  </div>
                  <div className="p-2 bg-slate-950/60 border border-slate-800 rounded-lg">
                    <code className="text-sky-300 font-bold">knx_read_group_address</code>
                    <div className="text-slate-400 text-[10px] mt-0.5">GA-Wert auf Bus lesen oder abfragen</div>
                  </div>
                  <div className="p-2 bg-slate-950/60 border border-slate-800 rounded-lg">
                    <code className="text-indigo-300 font-bold">knx_get_project_summary</code>
                    <div className="text-slate-400 text-[10px] mt-0.5">Räume, Geräte, GAs & Gateway-Status</div>
                  </div>
                  <div className="p-2 bg-slate-950/60 border border-slate-800 rounded-lg">
                    <code className="text-indigo-300 font-bold">knx_list_devices</code>
                    <div className="text-slate-400 text-[10px] mt-0.5">Geräte, Adressen & Dirty-Flash-Status</div>
                  </div>
                  <div className="p-2 bg-slate-950/60 border border-slate-800 rounded-lg">
                    <code className="text-emerald-300 font-bold">knx_list_group_addresses</code>
                    <div className="text-slate-400 text-[10px] mt-0.5">GAs nach Hauptgruppe oder Name filtern</div>
                  </div>
                  <div className="p-2 bg-slate-950/60 border border-slate-800 rounded-lg">
                    <code className="text-emerald-300 font-bold">knx_search_catalog</code>
                    <div className="text-slate-400 text-[10px] mt-0.5">SQLite Hardware-Katalog durchsuchen</div>
                  </div>
                  <div className="p-2 bg-slate-950/60 border border-slate-800 rounded-lg">
                    <code className="text-amber-300 font-bold">knx_get_device_parameters</code>
                    <div className="text-slate-400 text-[10px] mt-0.5">Parameter eines KNX-Geräts auflisten</div>
                  </div>
                  <div className="p-2 bg-slate-950/60 border border-slate-800 rounded-lg">
                    <code className="text-amber-300 font-bold">knx_set_device_parameter</code>
                    <div className="text-slate-400 text-[10px] mt-0.5">Parameter ändern & Flash dirty flag</div>
                  </div>
                </div>
              </div>

              {/* MCP Configuration Snippet */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-300">
                    Konfiguration (Claude Desktop / Cursor / Antigravity):
                  </span>
                  <button
                    onClick={() => handleCopyConfig('mcp', mcpConfigJson)}
                    className="flex items-center gap-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-[11px] font-medium transition-colors"
                  >
                    {copiedSnippet === 'mcp' ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-300 font-bold">Kopiert!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-slate-400" />
                        <span>JSON kopieren</span>
                      </>
                    )}
                  </button>
                </div>
                <div className="relative">
                  <pre className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-[10px] font-mono text-slate-300 overflow-x-auto select-all">
                    {mcpConfigJson}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-800 bg-slate-950/40 shrink-0">
          <button
            onClick={onClose}
            disabled={isSaving}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-slate-100 hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            {activeTab === 'mcp' ? t('common.close') : t('common.cancel')}
          </button>
          {activeTab === 'storage' && (
            <button
              onClick={handleSave}
              disabled={isSaving || isLoading}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white shadow-lg shadow-sky-900/40 transition-all"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{t('header.saving')}</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>{t('common.save')}</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
