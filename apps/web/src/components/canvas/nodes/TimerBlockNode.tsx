import React, { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import { Clock, Calendar, CheckCircle2, XCircle, Trash2 } from 'lucide-react'
import { FunctionBlock, GroupAddress } from '../../../types/knx'

interface TimerBlockNodeProps {
  data: {
    block: FunctionBlock
    groupAddresses: GroupAddress[]
    isSimulating: boolean
    onAction?: (pin: string, value: any) => void
    onDelete?: (blockId: string) => void
  }
}

export const TimerBlockNodeComponent: React.FC<TimerBlockNodeProps> = ({ data }) => {
  const { block, groupAddresses, onAction, onDelete } = data

  const state = block.state || {}
  const isActive = state.is_active ?? false
  const enabled = state.enabled ?? true
  const currentTime = state.current_time ?? '12:00'
  const onTime = block.parameters?.on_time ?? '07:00'
  const offTime = block.parameters?.off_time ?? '22:00'
  const activeDays = block.parameters?.active_days ?? [1, 2, 3, 4, 5] // Mo-Fr

  const daysLabels = [
    { id: 1, label: 'Mo' },
    { id: 2, label: 'Di' },
    { id: 3, label: 'Mi' },
    { id: 4, label: 'Do' },
    { id: 5, label: 'Fr' },
    { id: 6, label: 'Sa' },
    { id: 7, label: 'So' },
  ]

  const getGa = (pinId: string) => {
    return groupAddresses.find(
      (ga) => ga.origin_block_id === block.id && ga.origin_pin_name === pinId
    )?.address
  }

  return (
    <div
      className={`w-80 rounded-2xl border-2 shadow-lg transition-all ${
        isActive
          ? 'border-emerald-400 bg-slate-900 shadow-emerald-500/10'
          : 'border-slate-700 bg-slate-900 shadow-black/40'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3 bg-slate-800/60 rounded-t-2xl">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-teal-500/20 text-teal-400">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-bold text-slate-100">{block.name}</div>
            <div className="text-[11px] text-slate-400 font-mono">Zeitschaltuhr (Wochenplan)</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div
            className={`px-2.5 py-1 rounded-full text-xs font-bold border ${
              isActive
                ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                : 'bg-slate-800 text-slate-400 border-slate-700'
            }`}
          >
            {isActive ? 'AKTIV (1)' : 'INAKTIV (0)'}
          </div>

          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onDelete(block.id)
              }}
              title="Baustein löschen"
              className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="p-4 space-y-3 bg-slate-950/40">
        {/* Time Window Display */}
        <div className="flex items-center justify-between p-2.5 bg-slate-900/80 rounded-xl border border-slate-800 text-xs">
          <div>
            <span className="text-slate-400">Schaltfenster:</span>
            <div className="font-mono font-bold text-slate-100 mt-0.5">
              {onTime} - {offTime} Uhr
            </div>
          </div>
          <div className="text-right">
            <span className="text-slate-400">Aktuelle Zeit:</span>
            <div className="font-mono font-bold text-sky-400 mt-0.5">{currentTime}</div>
          </div>
        </div>

        {/* Days of Week Pills */}
        <div>
          <div className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-1.5">
            Aktive Wochentage
          </div>
          <div className="flex gap-1 justify-between">
            {daysLabels.map((d) => {
              const isSelected = activeDays.includes(d.id)
              return (
                <div
                  key={d.id}
                  className={`w-9 h-7 rounded-lg flex items-center justify-center text-xs font-mono font-bold border transition-colors ${
                    isSelected
                      ? 'bg-teal-950/80 border-teal-600 text-teal-300'
                      : 'bg-slate-900/50 border-slate-800 text-slate-600'
                  }`}
                >
                  {d.label}
                </div>
              )
            })}
          </div>
        </div>

        {/* Simulation Enable Toggle */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            onAction?.('enable', !enabled)
          }}
          className={`w-full py-1.5 rounded-lg text-xs font-medium border flex items-center justify-center gap-1.5 transition-all ${
            enabled
              ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
              : 'bg-red-950/40 border-red-800 text-red-300'
          }`}
        >
          {enabled ? (
            <>
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>Automatik freigegeben (Klick: Deaktivieren)</span>
            </>
          ) : (
            <>
              <XCircle className="w-3.5 h-3.5 text-red-400" />
              <span>Automatik gesperrt (Klick: Freigeben)</span>
            </>
          )}
        </button>
      </div>

      {/* Handles */}
      <div className="border-t border-slate-800/80 px-4 py-2.5 bg-slate-950/60 rounded-b-2xl flex justify-between text-xs">
        <div className="relative flex items-center gap-2">
          <Handle
            type="target"
            position={Position.Left}
            id="enable"
            className="!w-3 !h-3 !bg-teal-400 !border-2 !border-slate-900"
          />
          <span className="text-slate-300 font-mono text-[11px] pl-1">enable</span>
        </div>

        <div className="relative flex items-center justify-end gap-2">
          <span className="text-slate-300 font-mono text-[11px] pr-1">out</span>
          {getGa('out') && <span className="text-[9px] font-mono text-emerald-400 mr-1">{getGa('out')}</span>}
          <Handle
            type="source"
            position={Position.Right}
            id="out"
            className="!w-3 !h-3 !bg-emerald-400 !border-2 !border-slate-900"
          />
        </div>
      </div>
    </div>
  )
}

export const TimerBlockNode = memo(TimerBlockNodeComponent)
