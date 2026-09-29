import React, { useState, useEffect } from 'react'
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  Key,
  Lock,
  Unlock,
  RefreshCw,
  AlertTriangle,
  Info,
  Check,
  X,
  Camera,
  QrCode,
} from 'lucide-react'
import { KnxDevice } from '../../types/knx'
import { updateDeviceSecurity } from '../../services/api'
import { KnxQrScanner } from './KnxQrScanner'
import { KnxCertificateQrResult } from '../../utils/knxQrParser'

interface DeviceSecurityModalProps {
  isOpen: boolean
  onClose: () => void
  device: KnxDevice | null
  onSecuritySaved?: () => void
}

export const DeviceSecurityModal: React.FC<DeviceSecurityModalProps> = ({
  isOpen,
  onClose,
  device,
  onSecuritySaved,
}) => {
  const [isEnabled, setIsEnabled] = useState(false)
  const [serialNumber, setSerialNumber] = useState('')
  const [fdsk, setFdsk] = useState('')
  const [generateNewToolKey, setGenerateNewToolKey] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [isScannerOpen, setIsScannerOpen] = useState(false)

  // Sync state when device changes or modal opens
  useEffect(() => {
    if (device && device.security) {
      setIsEnabled(device.security.is_secure_enabled)
      setSerialNumber(device.security.serial_number || '')
      setFdsk(device.security.fdsk || '')
    } else {
      setIsEnabled(false)
      setSerialNumber('')
      setFdsk('')
    }
    setGenerateNewToolKey(false)
    setError(null)
    setSuccessMessage(null)
  }, [device, isOpen])

  if (!isOpen || !device) return null

  // FDSK validation helper: FDSK is either 32 hex chars or 36 chars with hyphens (e.g. 112233-445566-...)
  const cleanFdsk = fdsk.replace(/[^0-9a-fA-F]/g, '')
  const isValidFdskLength = cleanFdsk.length === 32

  const handleQrDetected = (result: KnxCertificateQrResult) => {
    if (result.serialNumber) {
      setSerialNumber(result.serialNumber)
    }
    if (result.fdsk) {
      setFdsk(result.fdsk)
      setIsEnabled(true)
    }
    setSuccessMessage('Gerätezertifikat erkannt: Seriennummer & FDSK automatisch übernommen!')
  }

  const handleSave = async () => {
    setError(null)
    setSuccessMessage(null)

    if (isEnabled && fdsk.trim() && !isValidFdskLength) {
      setError('Der FDSK muss genau 16 Bytes (32 Hex-Zeichen) lang sein.')
      return
    }

    setIsSaving(true)
    try {
      await updateDeviceSecurity(device.id, {
        is_secure_enabled: isEnabled,
        serial_number: serialNumber.trim() ? serialNumber.trim() : null,
        fdsk: fdsk.trim() ? fdsk.trim() : null,
        generate_new_tool_key: generateNewToolKey,
      })

      setSuccessMessage('Sicherheitseinstellungen erfolgreich aktualisiert.')
      if (onSecuritySaved) {
        onSecuritySaved()
      }
      setTimeout(() => {
        onClose()
      }, 700)
    } catch (err: any) {
      setError(err.message || 'Fehler beim Speichern der Sicherheitskonfiguration')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div
              className={`p-2 rounded-xl border ${
                isEnabled
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}
            >
              {isEnabled ? <ShieldCheck className="w-5 h-5" /> : <Shield className="w-5 h-5" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-slate-100">KNX Data Secure (TP)</h3>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  {device.individual_address}
                </span>
              </div>
              <p className="text-xs text-slate-400 truncate max-w-sm">{device.name}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          {error && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-start gap-2.5 text-xs text-rose-300">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {successMessage && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center gap-2.5 text-xs text-emerald-300">
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* Quick Scanner Action Banner */}
          <div className="p-3 bg-gradient-to-r from-emerald-500/10 via-teal-500/10 to-transparent rounded-xl border border-emerald-500/30 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center shrink-0">
                <QrCode className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-bold text-slate-100">Gerätezertifikat scannen</div>
                <div className="text-[10px] text-slate-400">
                  QR-Code am Aktor per Kamera oder Foto einlesen
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsScannerOpen(true)}
              className="py-1.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm shadow-emerald-600/30 transition-colors"
            >
              <Camera className="w-3.5 h-3.5" />
              <span>Scannen</span>
            </button>
          </div>

          {/* Hardware Serial Number Input */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-300">
              Geräte-Seriennummer (Hardware-ID für Direkt-Adressierung)
            </label>
            <input
              type="text"
              value={serialNumber}
              onChange={(e) => setSerialNumber(e.target.value)}
              placeholder="z. B. 00:83:76:8A:0C:65 oder 0083768A0C65"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-amber-500/60 transition-colors"
            />
            <p className="text-[10px] text-slate-500">
              Ermöglicht das Programmieren der physikalischen Adresse ohne Betätigen der Programmiertaste.
            </p>
          </div>

          {/* Enable Toggle */}
          <div className="p-3.5 bg-slate-950/40 rounded-xl border border-slate-800/80 flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="text-xs font-semibold text-slate-200">
                KNX Data Secure Verschlüsselung
              </div>
              <div className="text-[11px] text-slate-400">
                Verschlüsselt Management- & Gruppen-Telegramme auf TP via AES-128-CCM
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={isEnabled}
                onChange={(e) => setIsEnabled(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
            </label>
          </div>

          {isEnabled ? (
            <div className="space-y-4 animate-in fade-in duration-200">
              {/* FDSK Input */}
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-300">
                  Factory Default Setup Key (FDSK)
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={fdsk}
                    onChange={(e) => setFdsk(e.target.value)}
                    placeholder="z. B. 0123456789ABCDEF0123456789ABCDEF oder XXXXX-XXXXX-..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-amber-500/60 transition-colors"
                  />
                  {fdsk.trim() && (
                    <div className="absolute right-3 top-2.5">
                      {isValidFdskLength ? (
                        <Check className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <span className="text-[10px] font-mono text-amber-400">
                          {cleanFdsk.length}/32
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <p className="text-[11px] text-slate-500">
                  Der FDSK befindet sich auf dem Geräteaufkleber oder Beipackzettel des KNX-Geräts.
                </p>
              </div>

              {/* Tool-Key Info & Regeneration */}
              <div className="p-3.5 bg-slate-950/60 rounded-xl border border-slate-800/80 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                    <Key className="w-3.5 h-3.5 text-amber-400" />
                    Individueller Tool-Key
                  </span>
                  {device.security?.tool_key ? (
                    <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                      Aktiv
                    </span>
                  ) : (
                    <span className="text-[10px] font-mono text-slate-500 bg-slate-800 px-2 py-0.5 rounded">
                      Nicht generiert
                    </span>
                  )}
                </div>

                <div className="font-mono text-[11px] text-slate-400 bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-800 truncate">
                  {device.security?.tool_key || (generateNewToolKey ? 'Wird beim Speichern neu generiert...' : 'Kein Tool-Key gespeichert')}
                </div>

                <label className="flex items-center gap-2 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={generateNewToolKey}
                    onChange={(e) => setGenerateNewToolKey(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-950 text-amber-500 focus:ring-amber-500/40"
                  />
                  <span className="text-xs text-slate-300">
                    Neuen Tool-Key generieren & ins Gerät übertragen
                  </span>
                </label>
              </div>

              {/* Sequence Counter */}
              <div className="flex items-center justify-between text-xs px-1 text-slate-400">
                <span>Aktueller Sequenzzähler (Replay Protection):</span>
                <span className="font-mono text-slate-200">
                  {device.security?.sequence_number ?? 1}
                </span>
              </div>
            </div>
          ) : (
            <div className="p-4 bg-slate-950/20 rounded-xl border border-dashed border-slate-800 text-center text-xs text-slate-500">
              Gerät arbeitet im unverschlüsselten KNX Plaintext-Modus (TP).
            </div>
          )}

          {/* Info Notice */}
          <div className="p-3 bg-sky-500/5 border border-sky-500/15 rounded-xl flex items-start gap-2.5 text-[11px] text-sky-400/90 leading-relaxed">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              KNX Data Secure sichert Punkt-zu-Punkt-Kommunikation und Gruppenadressen ab.
              Geräte ohne FDSK können nur unverschlüsselt betrieben werden.
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-800 bg-slate-950/40">
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-xl text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            Abbrechen
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-1.5 rounded-xl text-xs font-semibold text-white bg-amber-600 hover:bg-amber-500 disabled:opacity-50 transition-colors flex items-center gap-1.5 shadow-md shadow-amber-600/20"
          >
            {isSaving ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                Speichern...
              </>
            ) : (
              'Sicherheitseinstellungen speichern'
            )}
          </button>
        </div>
      </div>

      {/* QR Scanner Modal */}
      <KnxQrScanner
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onDetected={handleQrDetected}
      />
    </div>
  )
}
