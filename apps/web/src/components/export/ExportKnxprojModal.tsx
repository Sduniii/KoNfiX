import React, { useState, useEffect } from 'react'
import {
  X,
  Download,
  FolderArchive,
  Lock,
  Unlock,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Cpu,
  Hash,
  Home,
  Check,
  Loader2,
  Key,
  Eye,
  EyeOff,
} from 'lucide-react'
import { Project } from '../../types/knx'
import { downloadKnxproj, fetchStorageSettings, updateStorageSettings } from '../../services/api'
import { useTranslation } from '../../i18n/I18nContext'

interface ExportKnxprojModalProps {
  isOpen: boolean
  onClose: () => void
  project: Project | null
}

export const ExportKnxprojModal: React.FC<ExportKnxprojModalProps> = ({
  isOpen,
  onClose,
  project,
}) => {
  const { t } = useTranslation()
  const [usePassword, setUsePassword] = useState(false)
  const [password, setPassword] = useState('')
  const [configuredKey, setConfiguredKey] = useState<string | null>(null)
  const [useCustomKey, setUseCustomKey] = useState(false)
  const [customKey, setCustomKey] = useState('')
  const [saveKeyPermanently, setSaveKeyPermanently] = useState(false)
  const [showKeyField, setShowKeyField] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSuccess, setIsSuccess] = useState(false)

  useEffect(() => {
    if (isOpen) {
      fetchStorageSettings()
        .then((s) => {
          setConfiguredKey(s.signing_key || null)
        })
        .catch(() => {})
    }
  }, [isOpen])

  if (!isOpen || !project) return null

  const deviceCount = project.devices?.length ?? 0
  const gaCount = project.group_addresses?.length ?? 0
  const roomCount = project.rooms?.length ?? 0
  const secureDeviceCount =
    project.devices?.filter((d) => d.security?.is_secure_enabled && d.security?.fdsk).length ?? 0
  const hasSigningKey = Boolean(customKey.trim() || configuredKey)

  const handleExport = async () => {
    setIsExporting(true)
    setError(null)
    setIsSuccess(false)

    try {
      if (customKey.trim() && saveKeyPermanently) {
        try {
          await updateStorageSettings(undefined, false, customKey.trim())
          setConfiguredKey('configured')
          setCustomKey('')
          setUseCustomKey(false)
        } catch (e) {
          console.warn('Could not permanently save signing key', e)
        }
      }

      await downloadKnxproj({
        password: usePassword && password.trim() ? password.trim() : undefined,
        signing_key: customKey.trim() ? customKey.trim() : undefined,
      })
      setIsSuccess(true)
      setTimeout(() => {
        setIsSuccess(false)
        onClose()
      }, 1500)
    } catch (err: any) {
      setError(err?.message || 'Export fehlgeschlagen')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-900/30 text-white">
              <FolderArchive className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">
                {t('export.title')}
              </h2>
              <p className="text-xs text-slate-400">
                {t('export.subtitle')}
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

        {/* Content */}
        <div className="p-6 space-y-5">
          {/* Project Overview Card */}
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300">{t('sidebar.project')}</span>
              <span className="text-sm font-bold text-emerald-400">{project.name}</span>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800/60 text-center">
              <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
                <div className="flex items-center justify-center gap-1 text-[11px] text-slate-400 mb-0.5">
                  <Cpu className="w-3.5 h-3.5 text-sky-400" />
                  <span>{t('common.devices')}</span>
                </div>
                <div className="text-base font-bold text-slate-100">{deviceCount}</div>
              </div>

              <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
                <div className="flex items-center justify-center gap-1 text-[11px] text-slate-400 mb-0.5">
                  <Hash className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{t('common.groupAddresses')}</span>
                </div>
                <div className="text-base font-bold text-slate-100">{gaCount}</div>
              </div>

              <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
                <div className="flex items-center justify-center gap-1 text-[11px] text-slate-400 mb-0.5">
                  <Home className="w-3.5 h-3.5 text-amber-400" />
                  <span>{t('rooms.title')}</span>
                </div>
                <div className="text-base font-bold text-slate-100">{roomCount}</div>
              </div>
            </div>

            {secureDeviceCount > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 bg-emerald-950/30 border border-emerald-500/30 rounded-lg text-xs text-emerald-300">
                <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-400" />
                <span>
                  <strong>{secureDeviceCount} Geräte mit KNX Data Secure:</strong> Tool-Keys &
                  FDSK-Zertifikate werden im Export automatisch hinterlegt.
                </span>
              </div>
            )}
          </div>

          {/* Digital Signature Section */}
          <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4 text-amber-400" />
                <span className="text-xs font-semibold text-slate-200">ETS-Projektsignatur</span>
              </div>
              {customKey.trim() ? (
                <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/20 text-emerald-300 font-medium flex items-center gap-1 border border-emerald-500/30">
                  <ShieldCheck className="w-3 h-3 text-emerald-400" />
                  Signierschlüssel bereit
                </span>
              ) : configuredKey && !useCustomKey ? (
                <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/20 text-emerald-300 font-medium flex items-center gap-1 border border-emerald-500/30">
                  <ShieldCheck className="w-3 h-3 text-emerald-400" />
                  Signierschlüssel aktiv
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-[10px] bg-amber-500/20 text-amber-300 font-medium flex items-center gap-1 border border-amber-500/30">
                  <AlertTriangle className="w-3 h-3 text-amber-400" />
                  Kein Signierschlüssel
                </span>
              )}
            </div>

            {/* Warning banner when no key is configured */}
            {!hasSigningKey && (
              <div className="flex items-start gap-2.5 p-3 bg-amber-950/40 border border-amber-500/40 rounded-lg text-amber-200 text-xs">
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
                <div className="space-y-1">
                  <div className="font-semibold text-amber-300">Wichtiger Hinweis zum ETS-Import:</div>
                  <p className="text-[11px] text-amber-200/90 leading-relaxed">
                    Es ist kein Signierschlüssel hinterlegt. Ohne diesen Schlüssel wird die Datei <strong>unsigniert</strong> exportiert und kann von der ETS nicht geöffnet werden (Fehler: <em>„Projekt Datei hat keine gültige Signatur“</em>).
                  </p>
                  <p className="text-[11px] text-amber-300 font-medium">
                    👉 Bitte trage deinen Signierschlüssel unten ein oder speichere ihn dauerhaft in den Systemeinstellungen.
                  </p>
                </div>
              </div>
            )}

            {configuredKey && !useCustomKey ? (
              <div className="flex items-center justify-between p-2.5 bg-slate-900/60 rounded-lg border border-slate-800 text-xs">
                <span className="text-slate-300 font-mono text-[11px] truncate max-w-[260px]">
                  Schlüssel aus Einstellungen aktiv ({configuredKey.length > 20 ? configuredKey.slice(0, 16) + '...' : configuredKey})
                </span>
                <button
                  type="button"
                  onClick={() => setUseCustomKey(true)}
                  className="text-xs text-sky-400 hover:text-sky-300 font-semibold"
                >
                  Anderen Schlüssel nutzen
                </button>
              </div>
            ) : (
              <div className="space-y-2.5 pt-1">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-medium text-slate-300">
                    {configuredKey ? 'Anderen Signierschlüssel eingeben:' : 'Signierschlüssel für ETS-Import eingeben:'}
                  </label>
                  {configuredKey && (
                    <button
                      type="button"
                      onClick={() => {
                        setUseCustomKey(false)
                        setCustomKey('')
                      }}
                      className="text-[11px] text-slate-400 hover:text-slate-200"
                    >
                      Zurück zu Standard
                    </button>
                  )}
                </div>

                <div className="relative">
                  <textarea
                    rows={4}
                    placeholder="RSA Private Key (PEM / Base64 einfügen)..."
                    value={customKey}
                    onChange={(e) => {
                      setCustomKey(e.target.value)
                      if (e.target.value.trim()) {
                        setUseCustomKey(true)
                      }
                    }}
                    className={`w-full pl-3 pr-10 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs font-mono text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 resize-y transition-all ${
                      !showKeyField && customKey ? 'filter blur-[3px] select-none' : ''
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKeyField(!showKeyField)}
                    className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-200"
                    title={showKeyField ? 'Schlüssel verbergen' : 'Schlüssel im Klartext anzeigen'}
                  >
                    {showKeyField ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>

                {customKey.trim() && (
                  <label className="flex items-center gap-2 pt-0.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={saveKeyPermanently}
                      onChange={(e) => setSaveKeyPermanently(e.target.checked)}
                      className="rounded border-slate-700 bg-slate-800 text-amber-500 focus:ring-amber-500 cursor-pointer"
                    />
                    <span className="text-[11px] text-slate-300">
                      Diesen Schlüssel dauerhaft in den KoNfiX-Einstellungen speichern
                    </span>
                  </label>
                )}
              </div>
            )}
          </div>

          {/* Password Protection Section */}
          <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                id="use-password"
                checked={usePassword}
                onChange={(e) => setUsePassword(e.target.checked)}
                className="mt-1 rounded border-slate-700 bg-slate-800 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-slate-900 cursor-pointer"
              />
              <div className="flex-1">
                <label
                  htmlFor="use-password"
                  className="text-xs font-semibold text-slate-200 flex items-center gap-1.5 cursor-pointer"
                >
                  {usePassword ? (
                    <Lock className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Unlock className="w-3.5 h-3.5 text-slate-400" />
                  )}
                  <span>{t('export.passwordProtection')}</span>
                </label>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Verschlüsselt das Projekt nach dem offiziellen ETS6-Standard (PBKDF2-HMAC-SHA256 &
                  AES-256).
                </p>
              </div>
            </div>

            {usePassword && (
              <div className="pt-2">
                <label className="block text-[11px] font-medium text-slate-300 mb-1">
                  Projektpasswort:
                </label>
                <input
                  type="password"
                  placeholder={t('export.passwordPlaceholder')}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                />
              </div>
            )}

            {!usePassword && (
              <p className="text-[11px] text-slate-400 italic bg-slate-900/60 px-3 py-2 rounded-lg border border-slate-800/80">
                💡 Ohne Passwort kann die Datei direkt per Doppelklick in jede ETS 5 oder ETS 6 ohne
                Passworteingabe importiert werden.
              </p>
            )}
          </div>

          {/* Error Message */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-950/40 border border-red-500/40 rounded-xl text-xs text-red-300">
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
              <span>{error}</span>
            </div>
          )}

          {/* Success Message */}
          {isSuccess && (
            <div className="flex items-center gap-2 p-3 bg-emerald-950/40 border border-emerald-500/40 rounded-xl text-xs text-emerald-300">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>{t('export.exported')}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-800 bg-slate-950/40">
          <button
            type="button"
            onClick={onClose}
            disabled={isExporting}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-slate-100 hover:bg-slate-800 transition-all disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>

          <button
            type="button"
            onClick={handleExport}
            disabled={isExporting || isSuccess || (usePassword && !password.trim())}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-white shadow-lg transition-all ${
              isSuccess
                ? 'bg-emerald-600 shadow-emerald-900/40'
                : isExporting
                ? 'bg-emerald-700 opacity-80 cursor-wait'
                : hasSigningKey
                ? 'bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 shadow-emerald-900/40'
                : 'bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 shadow-amber-900/40'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {isExporting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{t('export.exporting')}</span>
              </>
            ) : isSuccess ? (
              <>
                <Check className="w-4 h-4" />
                <span>{t('export.exported')}</span>
              </>
            ) : hasSigningKey ? (
              <>
                <Download className="w-4 h-4" />
                <span>{t('export.exportButton')}</span>
              </>
            ) : (
              <>
                <AlertTriangle className="w-4 h-4" />
                <span>Unsigniert exportieren (Warnung)</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
