import React, { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import { Sliders, Activity, Trash2 } from 'lucide-react'
import { FunctionBlock, GroupAddress } from '../../../types/knx'

interface ThresholdBlockNodeProps {
  data: {
    block: FunctionBlock
    groupAddresses: GroupAddress[]
    isSimulating: boolean
    onAction?: (pin: string, value: any) => void
    onDelete?: (blockId: string) => void
  }
}

export const ThresholdBlockNodeComponent: React.FC<ThresholdBlockNodeProps> = ({ data }) => {
  const { block, groupAddresses, onAction, onDelete } = data

  const state = block.state || {}
  const inVal = state.in_val ?? 21.5
  const out = state.out ?? false
  const threshOn = block.parameters?.threshold_on ?? 24.0
  const threshOff = block.parameters?.threshold_off ?? 22.0
  const direction = block.parameters?.direction ?? 'Above'

  const getGa = (pinId: string) => {
    return groupAddresses.find(
      (ga) => ga.origin_block_id === block.id && ga.origin_pin_name === pinId
    )?.address
  }

  return (
    <div
      className={`w-80 rounded-2xl border-2 shadow-lg transition-all ${
        out
          ? 'border-emerald-400 bg-slate-900 shadow-emerald-500/10'
          : 'border-slate-700 bg-slate-900 shadow-black/40'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3 bg-slate-800/60 rounded-t-2xl">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-orange-500/20 text-orange-400">
            <Sliders className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-bold text-slate-100">{block.name}</div>
            <div className="text-[11px] text-slate-400 font-mono">Schwellwertschalter (Hysterese)</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div
            className={`px-2.5 py-1 rounded-full text-xs font-bold border ${
              out
                ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                : 'bg-slate-800 text-slate-400 border-slate-700'
            }`}
          >
            {out ? 'EIN (1)' : 'AUS (0)'}
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
        {/* Value and Threshold Display */}
        <div className="grid grid-cols-3 gap-2 bg-slate-900/80 p-2.5 rounded-xl border border-slate-800 text-center">
          <div>
            <div className="text-[10px] text-slate-400 uppercase font-semibold">Ist-Wert</div>
            <div className="text-base font-bold text-sky-400 font-mono mt-0.5">{inVal.toFixed(1)}</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-400 uppercase font-semibold">EIN ab</div>
            <div className="text-sm font-bold text-emerald-400 font-mono mt-1">&ge; {threshOn}</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-400 uppercase font-semibold">AUS unter</div>
            <div className="text-sm font-bold text-rose-400 font-mono mt-1">&le; {threshOff}</div>
          </div>
        </div>

        {/* Quick Simulation Slider */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-[11px] text-slate-400">
            <span>Eingangssignal testen:</span>
            <span className="font-mono font-bold text-slate-200">{inVal.toFixed(1)}</span>
          </div>
          <input
            type="range"
            min="10"
            max="35"
            step="0.5"
            value={inVal}
            onChange={(e) => {
              e.stopPropagation()
              onAction?.('in_val', parseFloat(e.target.value))
            }}
            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-orange-500"
          />
        </div>
      </div>

      {/* Handles */}
      <div className="border-t border-slate-800/80 px-4 py-2.5 bg-slate-950/60 rounded-b-2xl flex justify-between text-xs">
        <div className="relative flex items-center gap-2">
          <Handle
            type="target"
            position={Position.Left}
            id="in_val"
            className="!w-3 !h-3 !bg-sky-400 !border-2 !border-slate-900"
          />
          <span className="text-slate-300 font-mono text-[11px] pl-1">in_val (analoger Wert)</span>
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

export const ThresholdBlockNode = memo(ThresholdBlockNodeComponent)
