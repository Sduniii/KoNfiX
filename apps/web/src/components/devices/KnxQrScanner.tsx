import React, { useRef, useEffect, useState, useCallback } from 'react'
import {
  Camera,
  X,
  Upload,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Maximize2,
  FlipHorizontal,
} from 'lucide-react'
import {
  decodeQrFromImageData,
  parseKnxCertificateQr,
  KnxCertificateQrResult,
} from '../../utils/knxQrParser'

interface KnxQrScannerProps {
  isOpen: boolean
  onClose: () => void
  onDetected: (result: KnxCertificateQrResult) => void
}

export const KnxQrScanner: React.FC<KnxQrScannerProps> = ({
  isOpen,
  onClose,
  onDetected,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [stream, setStream] = useState<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment')
  const [isScanning, setIsScanning] = useState(false)
  const [successResult, setSuccessResult] = useState<KnxCertificateQrResult | null>(null)

  // Start Camera Stream
  const startCamera = useCallback(async () => {
    setError(null)
    setSuccessResult(null)

    if (stream) {
      stream.getTracks().forEach((track) => track.stop())
    }

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Kamera-Zugriff wird von diesem Browser nicht unterstützt.')
      }

      const newStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      })

      setStream(newStream)
      if (videoRef.current) {
        videoRef.current.srcObject = newStream
        await videoRef.current.play().catch(() => {})
      }
      setIsScanning(true)
    } catch (err: any) {
      console.warn('Camera access failed:', err)
      setError(
        err.name === 'NotAllowedError'
          ? 'Kamerazugriff wurde im Browser verweigert. Bitte Berechtigung erteilen.'
          : err.message || 'Kamera konnte nicht initialisiert werden.'
      )
      setIsScanning(false)
    }
  }, [facingMode])

  // Stop Camera Stream
  const stopCamera = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop())
      setStream(null)
    }
    setIsScanning(false)
  }, [stream])

  // Toggle between environment (back) and user (front)
  const handleToggleFacingMode = () => {
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'))
  }

  // Effect to manage stream lifecycle
  useEffect(() => {
    if (isOpen) {
      startCamera()
    } else {
      stopCamera()
    }
    return () => {
      stopCamera()
    }
  }, [isOpen, startCamera, stopCamera])

  // Audio confirmation beep
  const playBeep = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
      const osc = audioCtx.createOscillator()
      const gain = audioCtx.createGain()
      osc.connect(gain)
      gain.connect(audioCtx.destination)
      osc.type = 'sine'
      osc.frequency.setValueAtTime(880, audioCtx.currentTime)
      gain.gain.setValueAtTime(0.1, audioCtx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15)
      osc.start()
      osc.stop(audioCtx.currentTime + 0.15)
    } catch {
      // AudioContext may be blocked or unsupported; ignore
    }
  }

  // Scanning loop on video frames
  useEffect(() => {
    let animId: number
    let isSubscribed = true

    const scanFrame = async () => {
      if (!isSubscribed || !videoRef.current || !canvasRef.current || !isScanning) {
        return
      }

      const video = videoRef.current
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        const canvas = canvasRef.current
        const ctx = canvas.getContext('2d', { willReadFrequently: true })

        if (ctx) {
          canvas.width = video.videoWidth
          canvas.height = video.videoHeight
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
          const qrText = await decodeQrFromImageData(imageData)

          if (qrText && isSubscribed) {
            const parsed = parseKnxCertificateQr(qrText)
            if (parsed.valid) {
              setSuccessResult(parsed)
              setIsScanning(false)
              playBeep()
              stopCamera()

              setTimeout(() => {
                onDetected(parsed)
                onClose()
              }, 800)
              return
            }
          }
        }
      }

      animId = requestAnimationFrame(scanFrame)
    }

    if (isScanning) {
      animId = requestAnimationFrame(scanFrame)
    }

    return () => {
      isSubscribed = false
      cancelAnimationFrame(animId)
    }
  }, [isScanning, onDetected, onClose, stopCamera])

  // Handle Image File Upload (Fallback)
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const img = new Image()
      img.onload = async () => {
        const canvas = canvasRef.current || document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.drawImage(img, 0, 0)
          const imageData = ctx.getImageData(0, 0, img.width, img.height)
          const qrText = await decodeQrFromImageData(imageData)
          if (qrText) {
            const parsed = parseKnxCertificateQr(qrText)
            if (parsed.valid) {
              setSuccessResult(parsed)
              playBeep()
              setTimeout(() => {
                onDetected(parsed)
                onClose()
              }, 600)
            } else {
              setError(`QR-Code erkannt, aber kein gültiges KNX-Zertifikat gefunden: "${qrText}"`)
            }
          } else {
            setError('Kein QR-Code im hochgeladenen Bild gefunden.')
          }
        }
      }
      img.src = event.target?.result as string
    }
    reader.readAsDataURL(file)
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-150">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-950/70">
          <div className="flex items-center gap-2">
            <Camera className="w-4 h-4 text-emerald-400" />
            <h4 className="text-xs font-bold text-slate-100 uppercase tracking-wide">
              KNX Data Secure QR-Scanner
            </h4>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Viewfinder Area */}
        <div className="relative aspect-square w-full bg-black flex items-center justify-center overflow-hidden">
          <video
            ref={videoRef}
            playsInline
            muted
            className="w-full h-full object-cover"
          />
          <canvas ref={canvasRef} className="hidden" />

          {/* Scanning Box Reticle */}
          {isScanning && !successResult && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="relative w-64 h-64 border-2 border-emerald-400/80 rounded-2xl shadow-[0_0_25px_rgba(16,185,129,0.3)] flex items-center justify-center">
                {/* Corner markers */}
                <div className="absolute -top-1 -left-1 w-6 h-6 border-t-4 border-l-4 border-emerald-400 rounded-tl" />
                <div className="absolute -top-1 -right-1 w-6 h-6 border-t-4 border-r-4 border-emerald-400 rounded-tr" />
                <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-4 border-l-4 border-emerald-400 rounded-bl" />
                <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-4 border-r-4 border-emerald-400 rounded-br" />

                {/* Animated Scan Line */}
                <div className="absolute left-2 right-2 h-0.5 bg-emerald-400/90 shadow-[0_0_10px_#10b981] animate-pulse" />
              </div>
            </div>
          )}

          {/* Success Overlay */}
          {successResult && (
            <div className="absolute inset-0 bg-emerald-950/80 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center animate-in zoom-in-95 duration-200">
              <div className="w-14 h-14 rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center text-emerald-400 mb-3 shadow-lg shadow-emerald-500/30">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h5 className="text-sm font-bold text-slate-100">Gerätezertifikat erkannt!</h5>
              {successResult.serialNumber && (
                <div className="text-xs font-mono text-emerald-300 mt-1">
                  SN: {successResult.serialNumber}
                </div>
              )}
              {successResult.fdsk && (
                <div className="text-[10px] font-mono text-slate-300 mt-0.5 truncate max-w-xs">
                  FDSK: {successResult.fdsk}
                </div>
              )}
            </div>
          )}

          {/* Camera Controls Overlay */}
          <div className="absolute bottom-3 right-3 flex items-center gap-2">
            <button
              onClick={handleToggleFacingMode}
              className="p-2 rounded-xl bg-slate-900/80 hover:bg-slate-900 border border-slate-700 text-slate-300 hover:text-white shadow-lg backdrop-blur-sm transition-colors"
              title="Kamera wechseln"
            >
              <FlipHorizontal className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Error or Instruction footer */}
        <div className="p-4 space-y-3 bg-slate-950/60 border-t border-slate-800">
          {error ? (
            <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-start gap-2 text-xs text-rose-300">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          ) : (
            <p className="text-xs text-slate-400 text-center">
              Halte den QR-Code des Geräteaufklebers vor die Kamera. Seriennummer und FDSK werden automatisch übernommen.
            </p>
          )}

          {/* Fallback File Upload Button */}
          <div className="flex items-center justify-between pt-1">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileUpload}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
            >
              <Upload className="w-3.5 h-3.5 text-amber-400" />
              <span>Foto / Bilddatei hochladen</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
