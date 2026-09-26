import React from 'react'
import { Handle, Position } from '@xyflow/react'
import { ToggleLeft } from 'lucide-react'

export interface SwitchChannelData {
  id: string
  code: string // e.g. "Taste 1"
  name: string // e.g. "Deckenlicht"
  gaAddress?: string
}

interface SwitchNodeProps {
  data: {
    deviceAddress: string
    deviceName: string
    manufacturer?: string
    channels: SwitchChannelData[]
    isSimulating: boolean
    onTriggerChannel?: (channelId: string, channelCode: string) => void
  }
}

export const SwitchNode: React.FC<SwitchNodeProps> = ({ data }) => {
  const { deviceAddress, deviceName, manufacturer, channels, onTriggerChannel } = data

  return (
    <div className="w-64 rounded-xl border-2 border-sky-500/60 bg-slate-900/95 shadow-2xl shadow-sky-950/50">
      {/* Device Header */}
      <div className="flex items-center justify-between border-b border-slate-800 px-3.5 py-2.5 bg-slate-800/60 rounded-t-lg">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-sky-500/20 text-sky-400">
            <ToggleLeft className="w-4 h-4" />
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-100">{deviceName}</div>
            <div className="text-[10px] text-slate-400 font-mono">
              {manufacturer || 'MDT'} • Taster ({channels.length} Tasten)
            </div>
          </div>
        </div>
        <span className="text-[10px] font-mono bg-sky-950 border border-sky-800/60 text-sky-300 px-1.5 py-0.5 rounded font-bold">
          {deviceAddress}
        </span>
      </div>

      {/* Tasten / Channels list */}
      <div className="p-2.5 space-y-2 bg-slate-950/40">
        <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 px-1">
          Tastenbelegung & Ausgänge
        </div>

        {channels.map((ch, idx) => (
          <div
            key={ch.id}
            className="p-2 rounded-lg border border-slate-800 bg-slate-900/90 flex items-center justify-between relative group hover:border-sky-500/50 transition-colors"
          >
            <div className="flex-1 min-w-0 pr-2">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-mono font-bold text-sky-400 bg-sky-950/80 px-1 rounded border border-sky-800/40">
                  {ch.code}
                </span>
                {ch.gaAddress && (
                  <span
                    className="text-[9px] font-mono text-emerald-400 bg-emerald-950/80 px-1 py-0.5 rounded border border-emerald-800/40"
                    title={`Verknüpfte KNX Gruppenadresse: ${ch.gaAddress}`}
                  >
                    {ch.gaAddress}
                  </span>
                )}
                <span className="text-xs text-slate-200 truncate font-medium">{ch.name}</span>
              </div>
            </div>

            <button
              onClick={(e) => {
                e.stopPropagation()
                onTriggerChannel?.(ch.id, ch.code)
              }}
              title="Klicken zum Senden (1-Bit Telegramm)"
              className="px-2 py-1 rounded bg-sky-600/30 hover:bg-sky-500 hover:text-slate-950 text-sky-300 border border-sky-500/40 text-[10px] font-bold font-mono transition-all active:scale-95 shrink-0"
            >
              Drücken
            </button>

            {/* Output Handle for this specific button */}
            <Handle
              type="source"
              position={Position.Right}
              id={`out-${ch.id}`}
              className="!w-3 !h-3 !bg-sky-400 !border-2 !border-slate-900 !-right-4 hover:scale-125 transition-transform"
            />
          </div>
        ))}
      </div>

      <div className="px-3 py-1.5 border-t border-slate-800/80 text-[10px] text-slate-500 font-mono text-center">
        Tipp: Ziehe von jedem blauen Punkt beliebig viele Leitungen
      </div>
    </div>
  )
}
