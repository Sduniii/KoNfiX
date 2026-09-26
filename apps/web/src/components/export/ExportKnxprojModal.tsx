import React, { useState } from 'react'
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
} from 'lucide-react'
import { Project } from '../../types/knx'
import { downloadKnxproj } from '../../services/api'
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
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSuccess, setIsSuccess] = useState(false)

  if (!isOpen || !project) return null

  const deviceCount = project.devices?.length ?? 0
  const gaCount = project.group_addresses?.length ?? 0
  const roomCount = project.rooms?.length ?? 0
  const secureDeviceCount =
    project.devices?.filter((d) => d.security?.is_secure_enabled && d.security?.fdsk).length ?? 0

  const handleExport = async () => {
    setIsExporting(true)
    setError(null)
    setIsSuccess(false)

    try {
      await downloadKnxproj({
        password: usePassword && password.trim() ? password.trim() : undefined,
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
                : 'bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 shadow-emerald-900/40'
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
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>{t('export.exportButton')}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
