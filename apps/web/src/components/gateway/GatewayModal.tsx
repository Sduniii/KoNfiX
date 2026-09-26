import React, { useState, useEffect, useCallback } from 'react'
import {
  X,
  Radio,
  Wifi,
  Server,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Activity,
  ArrowUpRight,
  ArrowDownLeft,
  Unplug,
  ShieldCheck,
  Zap,
  Lock,
  Key,
  Eye,
  EyeOff,
  Info,
  FolderKey,
  Upload,
  FileText,
  Check,
} from 'lucide-react'
import {
  DiscoveredGateway,
  GatewayConnectionStatus,
  KnxSecureCredentials,
  DecryptedKeyring,
} from '../../types/knx'
import {
  discoverGateways,
  connectGateway,
  disconnectGateway,
  getGatewayStatus,
  fetchLocalKeyrings,
  decryptKeyring,
  connectKeyring,
} from '../../services/api'

interface GatewayModalProps {
  isOpen: boolean
  onClose: () => void
  connectionStatus: GatewayConnectionStatus | null
  onStatusChange: (status: GatewayConnectionStatus) => void
}

export const GatewayModal: React.FC<GatewayModalProps> = ({
  isOpen,
  onClose,
  connectionStatus,
  onStatusChange,
}) => {
  const [discoveredList, setDiscoveredList] = useState<DiscoveredGateway[]>([])
  const [isScanning, setIsScanning] = useState(false)
  const [scanMessage, setScanMessage] = useState<string | null>(null)

  // Manual IP input
  const [manualIp, setManualIp] = useState('192.168.1.120')
  const [manualPort, setManualPort] = useState('3671')
  const [isConnecting, setIsConnecting] = useState(false)
  const [connectionError, setConnectionError] = useState<string | null>(null)

  // KNX IP Secure settings
  const [useSecure, setUseSecure] = useState(true)
  const [secureMode, setSecureMode] = useState<'keyring' | 'manual'>('keyring')

  // Manual credentials
  const [secureUserId, setSecureUserId] = useState('3')
  const [securePassword, setSecurePassword] = useState('')
  const [secureDeviceAuth, setSecureDeviceAuth] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  // Keyring mode
  const [localKeyrings, setLocalKeyrings] = useState<string[]>([])
  const [selectedKeyringPath, setSelectedKeyringPath] = useState<string>('')
  const [uploadedKeyringContent, setUploadedKeyringContent] = useState<string | null>(null)
  const [uploadedKeyringName, setUploadedKeyringName] = useState<string | null>(null)
  const [keyringPassword, setKeyringPassword] = useState('')
  const [showKeyringPassword, setShowKeyringPassword] = useState(false)
  const [decryptedKeyring, setDecryptedKeyring] = useState<DecryptedKeyring | null>(null)
  const [selectedKeyringUserId, setSelectedKeyringUserId] = useState<number>(3)
  const [isDecryptingKeyring, setIsDecryptingKeyring] = useState(false)
  const [keyringSuccessMessage, setKeyringSuccessMessage] = useState<string | null>(null)

  // Scan for gateways
  const handleScan = useCallback(async () => {
    setIsScanning(true)
    setScanMessage('Sende KNX SEARCH_REQUEST Multicast an 224.0.23.12:3671...')
    setConnectionError(null)

    try {
      const gateways = await discoverGateways()
      setDiscoveredList(gateways)
      if (gateways.length === 0) {
        setScanMessage(
          'Kein KNX-Gateway über Multicast gefunden. Falls Multicast im Netzwerk oder Docker blockiert ist, bitte manuelle IP nutzen.'
        )
      } else {
        setScanMessage(`${gateways.length} KNXnet/IP Schnittstelle(n) im lokalen Subnetz gefunden.`)
      }
    } catch (e: any) {
      setConnectionError(`Suchfehler: ${e.message || e}`)
      setScanMessage(null)
    } finally {
      setIsScanning(false)
    }
  }, [])

  // Auto-scan on opening modal if not connected and no items yet
  useEffect(() => {
    if (isOpen && !connectionStatus?.connected && discoveredList.length === 0 && !isScanning) {
      handleScan()
    }
  }, [isOpen, connectionStatus?.connected])

  // Load local keyrings on open
  useEffect(() => {
    if (isOpen) {
      fetchLocalKeyrings()
        .then((files) => {
          setLocalKeyrings(files)
          if (files.length > 0 && !selectedKeyringPath) {
            const tunnel2 = files.find((f) => f.includes('tunnel2'))
            setSelectedKeyringPath(tunnel2 || files[0])
          }
        })
        .catch(() => {})
    }
  }, [isOpen])

  // Test / preview decrypt keyring
  const handleTestDecryptKeyring = async () => {
    setIsDecryptingKeyring(true)
    setConnectionError(null)
    setKeyringSuccessMessage(null)
    try {
      if (!keyringPassword.trim()) {
        throw new Error('Bitte gib das Schlüsselbund-Passwort ein, das beim ETS-Export vergeben wurde.')
      }
      const decrypted = await decryptKeyring({
        filePath: selectedKeyringPath || undefined,
        content: uploadedKeyringContent || undefined,
        password: keyringPassword.trim(),
      })
      setDecryptedKeyring(decrypted)
      setKeyringSuccessMessage(
        `Projekt "${decrypted.project_name}" erfolgreich entschlüsselt! ${decrypted.tunnels.length} Tunnel gefunden.`
      )
      const hasUser3 = decrypted.tunnels.some((t) => t.user_id === 3)
      if (hasUser3) {
        setSelectedKeyringUserId(3)
      } else if (decrypted.tunnels.length > 0) {
        setSelectedKeyringUserId(decrypted.tunnels[0].user_id)
      }
    } catch (e: any) {
      setConnectionError(`Entschlüsselung fehlgeschlagen: ${e.message || e}`)
    } finally {
      setIsDecryptingKeyring(false)
    }
  }

  // Connect to a gateway
  const handleConnect = async (ip: string, portNum: number) => {
    setIsConnecting(true)
    setConnectionError(null)
    try {
      if (useSecure && secureMode === 'keyring') {
        if (!keyringPassword.trim()) {
          throw new Error('Bitte gib das Schlüsselbund-Passwort ein.')
        }
        await connectKeyring({
          ip,
          port: portNum,
          filePath: selectedKeyringPath || undefined,
          content: uploadedKeyringContent || undefined,
          password: keyringPassword.trim(),
          userId: selectedKeyringUserId,
        })
      } else {
        let secureCreds: KnxSecureCredentials | null = null
        if (useSecure) {
          if (!securePassword.trim()) {
            throw new Error('Bitte gib das KNX IP Secure Tunnel-Passwort für die gewählte User-ID aus ETS ein.')
          }
          secureCreds = {
            user_id: parseInt(secureUserId, 10) || 2,
            user_password: securePassword.trim(),
            device_authentication: secureDeviceAuth.trim() || undefined,
          }
        }
        await connectGateway(ip, portNum, secureCreds)
      }

      // Poll new status
      const updated = await getGatewayStatus()
      onStatusChange(updated)
    } catch (e: any) {
      setConnectionError(`Verbindung fehlgeschlagen: ${e.message || e}`)
    } finally {
      setIsConnecting(false)
    }
  }

  // Disconnect from current gateway
  const handleDisconnect = async () => {
    setIsConnecting(true)
    setConnectionError(null)
    try {
      await disconnectGateway()
      const updated = await getGatewayStatus()
      onStatusChange(updated)
    } catch (e: any) {
      setConnectionError(`Trennen fehlgeschlagen: ${e.message || e}`)
    } finally {
      setIsConnecting(false)
    }
  }

  if (!isOpen) return null

  const isConnected = connectionStatus?.connected ?? false

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/80">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <Radio className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-100">
                  KNXnet/IP Gateway Verbindung
                </h2>
                <span
                  className={`text-[10px] uppercase font-mono px-2 py-0.5 rounded-full border ${
                    isConnected
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 font-semibold'
                      : 'bg-slate-800 border-slate-700 text-slate-400'
                  }`}
                >
                  {isConnected ? 'Verbunden' : 'Getrennt'}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Verbindet den Rust Core direkt per KNXnet/IP Tunneling mit der realen Bus-Hardware
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

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* Error Banner */}
          {connectionError && (
            <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-300 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div className="flex-1">{connectionError}</div>
            </div>
          )}

          {/* Active Connection Status Card */}
          {isConnected && connectionStatus && (
            <div className="rounded-xl bg-gradient-to-br from-emerald-950/40 to-slate-900 border border-emerald-500/30 p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="font-semibold text-sm text-emerald-300">
                    Aktive KNXnet/IP Tunneling-Verbindung
                  </span>
                </div>
                <button
                  onClick={handleDisconnect}
                  disabled={isConnecting}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30 transition-colors disabled:opacity-50"
                >
                  <Unplug className="w-3.5 h-3.5" />
                  <span>Trennen</span>
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
                <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800">
                  <div className="text-[10px] text-slate-500 font-sans uppercase">Gateway IP</div>
                  <div className="font-semibold text-slate-200 truncate">
                    {connectionStatus.gateway_ip}:{connectionStatus.gateway_port}
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800">
                  <div className="text-[10px] text-slate-500 font-sans uppercase">Tunnel Adresse</div>
                  <div className="font-semibold text-emerald-400">
                    {connectionStatus.individual_address || '1.1.250'}
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800">
                  <div className="text-[10px] text-slate-500 font-sans uppercase">Channel ID</div>
                  <div className="font-semibold text-sky-400">
                    #{connectionStatus.channel_id ?? 1}
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800">
                  <div className="text-[10px] text-slate-500 font-sans uppercase">Heartbeat</div>
                  <div className="font-semibold text-slate-300">
                    {connectionStatus.last_heartbeat
                      ? new Date(connectionStatus.last_heartbeat).toLocaleTimeString()
                      : 'Aktiv (30s)'}
                  </div>
                </div>
              </div>

              {/* Telegram Counters */}
              <div className="flex items-center gap-4 pt-1 text-xs text-slate-400">
                <div className="flex items-center gap-1.5">
                  <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Gesendet:</span>
                  <span className="font-mono font-bold text-slate-200">
                    {connectionStatus.telegrams_sent}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <ArrowDownLeft className="w-3.5 h-3.5 text-sky-400" />
                  <span>Empfangen:</span>
                  <span className="font-mono font-bold text-slate-200">
                    {connectionStatus.telegrams_received}
                  </span>
                </div>
                <div className="ml-auto text-[11px] text-emerald-400 flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Live Bus Sync aktiv</span>
                </div>
              </div>
            </div>
          )}

          {/* KNX IP Secure Settings */}
          <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className={`p-1.5 rounded-lg border ${
                  useSecure
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                    : 'bg-slate-800 border-slate-700 text-slate-500'
                }`}>
                  <Lock className="w-4 h-4" />
                </div>
                <div>
                  <label htmlFor="secure-toggle" className="text-sm font-semibold text-slate-200 cursor-pointer select-none">
                    KNX IP Secure (Verschlüsseltes TCP Tunneling)
                  </label>
                  <p className="text-[11px] text-slate-400">
                    Erforderlich für sichere IP-Interfaces (z. B. MDT SCN-IP000.03 mit Secure Tunneling)
                  </p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  id="secure-toggle"
                  type="checkbox"
                  checked={useSecure}
                  onChange={(e) => setUseSecure(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600"></div>
              </label>
            </div>

            {useSecure && (
              <div className="space-y-4 pt-3 border-t border-slate-800/80">
                {/* Sub-tab selection */}
                <div className="flex items-center gap-2 p-1 rounded-lg bg-slate-900 border border-slate-800 text-xs">
                  <button
                    type="button"
                    onClick={() => setSecureMode('keyring')}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md font-medium transition-all ${
                      secureMode === 'keyring'
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <FolderKey className="w-3.5 h-3.5" />
                    <span>ETS-Schlüsselbund (.knxkeys)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSecureMode('manual')}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md font-medium transition-all ${
                      secureMode === 'manual'
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Key className="w-3.5 h-3.5" />
                    <span>Manuelle Zugangsdaten</span>
                  </button>
                </div>

                {secureMode === 'keyring' ? (
                  <div className="space-y-3 animate-in fade-in duration-150">
                    <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300 flex items-start gap-2.5">
                      <Info className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
                      <div className="space-y-0.5">
                        <p className="font-semibold">Automatische Entschlüsselung aller Tunnel & Schlüssel:</p>
                        <p className="text-[11px] text-emerald-300/80 leading-relaxed">
                          Wähle die exportierte <code>.knxkeys</code>-Datei und gib dein Export-Passwort ein. Alle Tunnel (inkl. freiem Tunnel 2 / User 3) werden automatisch erkannt!
                        </p>
                      </div>
                    </div>

                    {/* Local files list if detected */}
                    {localKeyrings.length > 0 && (
                      <div className="space-y-1.5">
                        <label className="block text-[10px] uppercase font-mono text-slate-400">
                          Gefundene Schlüsselbünde auf deinem PC:
                        </label>
                        <div className="space-y-1.5">
                          {localKeyrings.map((filePath, idx) => {
                            const fileName = filePath.split('/').pop() || filePath
                            const isSelected = selectedKeyringPath === filePath && !uploadedKeyringContent
                            return (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => {
                                  setSelectedKeyringPath(filePath)
                                  setUploadedKeyringContent(null)
                                  setUploadedKeyringName(null)
                                }}
                                className={`w-full text-left p-2.5 rounded-lg border text-xs flex items-center justify-between transition-all ${
                                  isSelected
                                    ? 'bg-emerald-950/30 border-emerald-500/50 text-emerald-200 shadow-sm'
                                    : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:bg-slate-800/60'
                                }`}
                              >
                                <div className="flex items-center gap-2 truncate">
                                  <FileText className="w-4 h-4 text-emerald-400 shrink-0" />
                                  <div className="truncate">
                                    <div className="font-mono font-medium truncate">{fileName}</div>
                                    <div className="text-[10px] text-slate-500 truncate">{filePath}</div>
                                  </div>
                                </div>
                                {isSelected && <Check className="w-4 h-4 text-emerald-400 shrink-0 ml-2" />}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* File upload alternative */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[10px] uppercase font-mono text-slate-400">
                          Oder andere .knxkeys Datei hochladen:
                        </label>
                        {uploadedKeyringName && (
                          <span className="text-[10px] text-emerald-400 font-mono">
                            Ausgewählt: {uploadedKeyringName}
                          </span>
                        )}
                      </div>
                      <label className="flex items-center justify-center gap-2 p-2 rounded-lg border border-dashed border-slate-700 hover:border-slate-500 bg-slate-900/40 text-slate-400 hover:text-slate-200 cursor-pointer text-xs transition-colors">
                        <Upload className="w-4 h-4" />
                        <span>Datei (.knxkeys) auswählen...</span>
                        <input
                          type="file"
                          accept=".knxkeys,.xml"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (file) {
                              setUploadedKeyringName(file.name)
                              const reader = new FileReader()
                              reader.onload = (event) => {
                                const text = event.target?.result as string
                                setUploadedKeyringContent(text)
                                setSelectedKeyringPath('')
                              }
                              reader.readAsText(file)
                            }
                          }}
                        />
                      </label>
                    </div>

                    {/* Password input */}
                    <div className="space-y-1">
                      <label className="block text-[10px] uppercase font-mono text-slate-400">
                        Schlüsselbund-Passwort (beim ETS-Export vergeben)
                      </label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <input
                            type={showKeyringPassword ? 'text' : 'password'}
                            value={keyringPassword}
                            onChange={(e) => setKeyringPassword(e.target.value)}
                            placeholder="Passwort eingeben..."
                            className="w-full pl-3 pr-10 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 text-xs font-mono focus:outline-none focus:border-emerald-500"
                          />
                          <button
                            type="button"
                            onClick={() => setShowKeyringPassword(!showKeyringPassword)}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                          >
                            {showKeyringPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={handleTestDecryptKeyring}
                          disabled={isDecryptingKeyring || !keyringPassword.trim()}
                          className="px-3 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 transition-colors disabled:opacity-50 shrink-0"
                        >
                          {isDecryptingKeyring ? 'Prüfe...' : 'Schlüsselbund prüfen'}
                        </button>
                      </div>
                    </div>

                    {/* Success message / decrypted tunnels */}
                    {keyringSuccessMessage && (
                      <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300">
                        <div className="font-semibold">{keyringSuccessMessage}</div>
                        {decryptedKeyring && decryptedKeyring.tunnels.length > 0 && (
                          <div className="mt-2 space-y-1.5 pt-2 border-t border-emerald-500/20">
                            <div className="text-[10px] uppercase font-mono text-emerald-400">
                              Wähle den Ziel-Tunnel:
                            </div>
                            <div className="grid grid-cols-1 gap-1.5">
                              {decryptedKeyring.tunnels.map((tun) => {
                                const isUser2 = tun.user_id === 2
                                const isSelected = selectedKeyringUserId === tun.user_id
                                return (
                                  <label
                                    key={tun.user_id}
                                    className={`p-2 rounded-lg border flex items-center justify-between cursor-pointer transition-all ${
                                      isSelected
                                        ? 'bg-emerald-900/40 border-emerald-500 text-slate-100'
                                        : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:bg-slate-800'
                                    }`}
                                  >
                                    <div className="flex items-center gap-2">
                                      <input
                                        type="radio"
                                        name="tunnelSelection"
                                        checked={isSelected}
                                        onChange={() => setSelectedKeyringUserId(tun.user_id)}
                                        className="text-emerald-500 focus:ring-0"
                                      />
                                      <span className="font-mono font-medium">
                                        Tunnel {tun.user_id === 2 ? '1' : tun.user_id === 3 ? '2' : tun.user_id === 4 ? '3' : `${tun.user_id}`} (User-ID {tun.user_id}, IA {tun.individual_address})
                                      </span>
                                    </div>
                                    <span className="text-[10px] px-2 py-0.5 rounded font-sans font-medium bg-slate-800 border border-slate-700">
                                      {isUser2 ? 'Home Assistant' : tun.user_id === 3 ? 'Empfohlen' : 'Verfügbar'}
                                    </span>
                                  </label>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3 animate-in fade-in duration-150">
                    <div className="p-3 rounded-lg bg-sky-500/10 border border-sky-500/20 text-xs text-sky-300 flex items-start gap-2.5">
                      <Info className="w-4 h-4 shrink-0 text-sky-400 mt-0.5" />
                      <div className="space-y-1">
                        <p className="font-semibold">ETS Tunneling Anmeldedaten:</p>
                        <p className="text-[11px] text-sky-300/80 leading-relaxed">
                          Trage hier die Tunnel-Zugangsdaten aus ETS manuell ein (z. B. User-ID 3 und das zugehörige Passwort).
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="sm:col-span-1">
                        <label className="block text-[10px] uppercase font-mono text-slate-400 mb-1">
                          Tunnel User-ID
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={255}
                          value={secureUserId}
                          onChange={(e) => setSecureUserId(e.target.value)}
                          placeholder="3"
                          className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 text-xs font-mono focus:outline-none focus:border-emerald-500"
                        />
                        <span className="text-[10px] text-slate-500 block mt-1">z. B. 3 falls HA User 2 nutzt</span>
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block text-[10px] uppercase font-mono text-slate-400 mb-1">
                          Tunnel-Passwort (User-Passwort)
                        </label>
                        <div className="relative">
                          <input
                            type={showPassword ? 'text' : 'password'}
                            value={securePassword}
                            onChange={(e) => setSecurePassword(e.target.value)}
                            placeholder="Passwort für diese User-ID aus ETS..."
                            className="w-full pl-3 pr-10 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 text-xs font-mono focus:outline-none focus:border-emerald-500"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                          >
                            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                        <span className="text-[10px] text-slate-500 block mt-1">Aus ETS Schlüsselbund für diesen Tunnel</span>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] uppercase font-mono text-slate-400 mb-1">
                        Geräte-Authentifizierungsschlüssel (Optional)
                      </label>
                      <input
                        type="password"
                        value={secureDeviceAuth}
                        onChange={(e) => setSecureDeviceAuth(e.target.value)}
                        placeholder="Optional (nur wenn Geräteauthentifizierung in ETS aktiv ist)"
                        className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 text-xs font-mono focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Auto-Discovery Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wifi className="w-4 h-4 text-sky-400" />
                <h3 className="text-sm font-semibold text-slate-200">
                  Automatische Gateway-Erkennung (UDP Multicast)
                </h3>
              </div>
              <button
                onClick={handleScan}
                disabled={isScanning}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 border border-sky-500/30 transition-all disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
                <span>{isScanning ? 'Suche läuft...' : 'Netzwerk scannen'}</span>
              </button>
            </div>

            {scanMessage && (
              <p className="text-xs text-slate-400 italic px-1">{scanMessage}</p>
            )}

            {/* Discovered List */}
            {discoveredList.length > 0 ? (
              <div className="space-y-2">
                {discoveredList.map((gw, idx) => {
                  const isThisGwConnected =
                    isConnected && connectionStatus?.gateway_ip === gw.ip
                  return (
                    <div
                      key={idx}
                      className={`p-3.5 rounded-xl border transition-all flex items-center justify-between ${
                        isThisGwConnected
                          ? 'bg-emerald-950/20 border-emerald-500/40 shadow-sm'
                          : 'bg-slate-800/60 hover:bg-slate-800 border-slate-700/60'
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Server className="w-4 h-4 text-emerald-400" />
                          <span className="font-semibold text-sm text-slate-100">
                            {gw.name || 'KNXnet/IP Interface'}
                          </span>
                          {gw.individual_address && (
                            <span className="text-[10px] font-mono bg-slate-900 border border-slate-700 text-slate-300 px-1.5 py-0.5 rounded">
                              IA: {gw.individual_address}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-400 flex items-center gap-3 font-mono">
                          <span>IP: {gw.ip}:{gw.port}</span>
                          {gw.mac_address && <span>MAC: {gw.mac_address}</span>}
                          <span className="text-[10px] font-sans text-slate-500">Medium: {gw.medium}</span>
                        </div>
                      </div>

                      <div>
                        {isThisGwConnected ? (
                          <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-semibold px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                            <CheckCircle2 className="w-4 h-4" />
                            <span>Verbunden</span>
                          </div>
                        ) : (
                          <button
                            onClick={() => handleConnect(gw.ip, gw.port)}
                            disabled={isConnecting || isConnected}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-700/20 transition-all disabled:opacity-50"
                          >
                            <Zap className="w-3.5 h-3.5" />
                            <span>Verbinden</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : !isScanning ? (
              <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-800 text-center text-xs text-slate-400">
                Keine KNX-Gateways im Suchlauf gefunden. Nutze unten die manuelle IP-Verbindung.
              </div>
            ) : null}
          </div>

          {/* Manual Connection Section */}
          <div className="space-y-3 pt-2 border-t border-slate-800">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-semibold text-slate-200">
                Manuelle Verbindung (IP / Host)
              </h3>
            </div>
            <p className="text-xs text-slate-400">
              Direkt verbinden per IP-Adresse (z.B. IP Router, USB-IP Gateway, Docker-Container oder Weinzierl/MDT Schnittstelle).
            </p>

            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="block text-[10px] uppercase font-mono text-slate-400 mb-1">
                  Gateway IP-Adresse
                </label>
                <input
                  type="text"
                  value={manualIp}
                  onChange={(e) => setManualIp(e.target.value)}
                  placeholder="192.168.1.50"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-200 text-xs font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div className="w-24">
                <label className="block text-[10px] uppercase font-mono text-slate-400 mb-1">
                  Port
                </label>
                <input
                  type="text"
                  value={manualPort}
                  onChange={(e) => setManualPort(e.target.value)}
                  placeholder="3671"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-200 text-xs font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div className="pt-5">
                <button
                  onClick={() => handleConnect(manualIp.trim(), parseInt(manualPort.trim(), 10) || 3671)}
                  disabled={isConnecting || isConnected || !manualIp.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-700/20 transition-all disabled:opacity-50"
                >
                  <Zap className="w-3.5 h-3.5" />
                  <span>{isConnecting ? 'Verbinde...' : 'Verbinden'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-800 bg-slate-900/80 flex items-center justify-between text-xs text-slate-400">
          <div>
            Protokoll:{' '}
            <span className="font-mono text-slate-300">KNXnet/IP v1.0 (Core & Tunneling)</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg font-medium text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
          >
            Schließen
          </button>
        </div>
      </div>
    </div>
  )
}
