import React, { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import { Cpu, ToggleLeft, Trash2, Power, ArrowUpDown } from 'lucide-react'
import { ChannelType } from '../../../types/knx'

export interface ChannelTerminalData {
  channelId: string
  channelCode: string
  channelName: string
  channelType: ChannelType
  deviceAddress: string
  deviceName: string
  manufacturer?: string
  gaAddress?: string
  isSimulating?: boolean
  onTrigger?: () => void
  onDelete?: (nodeId: string) => void
}

interface ChannelTerminalNodeProps {
  id: string
  data: ChannelTerminalData
  selected?: boolean
}

export const ChannelTerminalNodeComponent: React.FC<ChannelTerminalNodeProps> = ({
  id,
  data,
  selected,
}) => {
  const {
    channelCode,
    channelName,
    channelType,
    deviceAddress,
    deviceName,
    gaAddress,
    onTrigger,
    onDelete,
  } = data

  const isInputSensor =
    channelType === 'PushButtonInput' || channelType === 'PresenceSensorInput'
  const isBlind = channelType === 'BlindOutput'

  return (
    <div
      className={`w-64 rounded-xl border-2 bg-slate-900 shadow-md shadow-black/40 transition-all select-none ${
        selected
          ? 'border-sky-400 ring-2 ring-sky-400/40 shadow-sky-500/20'
          : isInputSensor
          ? 'border-sky-500/70 hover:border-sky-400'
          : isBlind
          ? 'border-teal-500/70 hover:border-teal-400'
          : 'border-emerald-500/70 hover:border-emerald-400'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2 bg-slate-800/60 rounded-t-lg">
        <div className="flex items-center gap-1.5 min-w-0">
          <div
            className={`p-1 rounded-md shrink-0 ${
              isInputSensor
                ? 'bg-sky-500/20 text-sky-400'
                : isBlind
                ? 'bg-teal-500/20 text-teal-400'
                : 'bg-emerald-500/20 text-emerald-400'
            }`}
          >
            {isInputSensor ? (
              <ToggleLeft className="w-3.5 h-3.5" />
            ) : isBlind ? (
              <ArrowUpDown className="w-3.5 h-3.5" />
            ) : (
              <Cpu className="w-3.5 h-3.5" />
            )}
          </div>
          <div className="truncate">
            <span className="text-[11px] font-semibold text-slate-200 truncate block">
              {deviceName}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0 ml-1">
          <span className="text-[10px] font-mono bg-slate-950 text-slate-300 border border-slate-700/80 px-1.5 py-0.5 rounded font-bold">
            {deviceAddress}
          </span>
          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onDelete(id)
              }}
              title="Klemme von Seite entfernen"
              className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="p-3 space-y-2 bg-slate-950/40">
        <div className="flex items-center justify-between gap-1">
          <span className="text-[10px] font-mono font-bold text-sky-400 bg-sky-950/80 px-1.5 py-0.5 rounded border border-sky-800/40 shrink-0">
            {channelCode}
          </span>
          <span className="text-[10px] text-slate-400 font-mono truncate">
            {channelType === 'PushButtonInput'
              ? 'Taster-Wippe'
              : channelType === 'DimmerOutput'
              ? 'Dimm-Kanal'
              : channelType === 'BlindOutput'
              ? 'Jalousie-Kanal'
              : 'Schalt-Kanal'}
          </span>
        </div>

        <div className="text-xs font-medium text-slate-100 truncate" title={channelName}>
          {channelName}
        </div>

        {/* Action Button for Switch or Group Address info */}
        {isInputSensor && (
          <div className="pt-1 flex items-center justify-between border-t border-slate-800/80">
            <span className="text-[10px] text-slate-400">Signal senden:</span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onTrigger?.()
              }}
              title="Klicken zum Auslösen (Telegramm senden)"
              className="px-2 py-0.5 rounded bg-sky-600/30 hover:bg-sky-500 hover:text-slate-950 text-sky-300 border border-sky-500/40 text-[10px] font-bold font-mono transition-all active:scale-95 flex items-center gap-1"
            >
              <Power className="w-2.5 h-2.5" />
              Drücken
            </button>
          </div>
        )}
      </div>

      {/* Terminal Connection Handle Footer */}
      <div className="px-3 py-1.5 border-t border-slate-800 bg-slate-900/80 rounded-b-lg flex items-center justify-between text-[10px] font-mono">
        {isInputSensor ? (
          <>
            <span className="text-slate-400">KNX Bus (Ausgang)</span>
            <div className="relative flex items-center gap-1.5">
              {gaAddress && (
                <span
                  className="text-sky-400 font-bold bg-sky-950/80 px-1.5 py-0.2 rounded border border-sky-800/40"
                  title={`Verknüpfte KNX Gruppenadresse: ${gaAddress}`}
                >
                  {gaAddress}
                </span>
              )}
              <Handle
                type="source"
                position={Position.Right}
                id="out"
                className="!w-3 !h-3 !bg-sky-400 !border-2 !border-slate-900 !-right-4 hover:scale-125 transition-transform"
              />
            </div>
          </>
        ) : (
          <>
            <div className="relative flex items-center gap-1.5">
              <Handle
                type="target"
                position={Position.Left}
                id="in"
                className={`!w-3 !h-3 !border-2 !border-slate-900 !-left-4 hover:scale-125 transition-transform ${
                  isBlind ? '!bg-teal-400' : '!bg-emerald-400'
                }`}
              />
              <span className="text-slate-400">KNX Last (Eingang)</span>
            </div>
            {gaAddress && (
              <span
                className={`font-bold px-1.5 py-0.2 rounded border ${
                  isBlind
                    ? 'text-teal-400 bg-teal-950/80 border-teal-800/40'
                    : 'text-emerald-400 bg-emerald-950/80 border-emerald-800/40'
                }`}
                title={`Verknüpfte KNX Gruppenadresse: ${gaAddress}`}
              >
                {gaAddress}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export const ChannelTerminalNode = memo(ChannelTerminalNodeComponent)
