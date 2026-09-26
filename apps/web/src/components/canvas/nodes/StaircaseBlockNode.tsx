import React, { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import { Timer, Play, Clock, Trash2 } from 'lucide-react'
import { FunctionBlock, GroupAddress } from '../../../types/knx'

interface StaircaseBlockNodeProps {
  data: {
    block: FunctionBlock
    groupAddresses: GroupAddress[]
    isSimulating: boolean
    onAction?: (pin: string, value: any) => void
    onDelete?: (blockId: string) => void
  }
}

export const StaircaseBlockNodeComponent: React.FC<StaircaseBlockNodeProps> = ({ data }) => {
  const { block, groupAddresses, onAction, onDelete } = data
  const isOn = block.state?.is_on ?? false
  const durationSec = block.parameters?.duration_sec ?? 120
  const remainingSec = block.state?.remaining_sec ?? (isOn ? durationSec : 0)

  const getGa = (pinId: string) => {
    const direct = groupAddresses.find(
      (ga) => ga.origin_block_id === block.id && ga.origin_pin_name === pinId
    )?.address
    if (direct) return direct

    if (pinId === 'trig') {
      return groupAddresses.find(
        (ga) => ga.origin_block_id === block.id && ga.origin_pin_name === 'sw'
      )?.address
    }

    return undefined
  }

  const handleTrigger = (e: React.MouseEvent) => {
    e.stopPropagation()
    onAction?.('trig', true)
  }

  return (
    <div className={`w-80 rounded-xl border-2 shadow-lg transition-all ${
      isOn
        ? 'border-yellow-400 bg-slate-900 shadow-yellow-500/10'
        : 'border-slate-700 bg-slate-900 shadow-black/40'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5 bg-slate-800/60 rounded-t-lg">
        <div className="flex items-center gap-2.5">
          <div className={`p-1.5 rounded-lg ${isOn ? 'bg-yellow-500/20 text-yellow-400' : 'bg-slate-700 text-slate-400'}`}>
            <Timer className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-100">{block.name}</div>
            <div className="text-[10px] text-slate-400 font-mono">Treppenlichtzeitschalter</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleTrigger}
            className={`px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1 transition-all ${
              isOn
                ? 'bg-yellow-500 text-slate-950 font-bold hover:bg-yellow-400'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <Play className="w-3 h-3 fill-current" />
            {isOn ? 'Nachstarten' : 'Trigger'}
          </button>
          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onDelete(block.id)
              }}
              title="Baustein löschen (Entf)"
              className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Body / Timer progress */}
      <div className="p-4 space-y-3 bg-slate-950/50">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400 flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 text-yellow-400" /> Restzeit
          </span>
          <span className="font-mono font-bold text-slate-200">
            {isOn ? `${remainingSec} s aktiv` : `Bereit (${durationSec} s)`}
          </span>
        </div>

        <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${isOn ? 'bg-yellow-400 animate-pulse' : 'bg-slate-600'}`}
            style={{ width: isOn ? '100%' : '0%' }}
          />
        </div>

        <div className="flex items-center justify-between pt-1 border-t border-slate-800/80 text-[11px] text-slate-400 font-mono">
          <span>Ausschaltvorwarnung:</span>
          <span className="text-yellow-400 font-semibold">Aktiv (30s Blinken)</span>
        </div>
      </div>

      {/* Handles */}
      <div className="grid grid-cols-2 p-3 gap-2 border-t border-slate-800 bg-slate-900/80 rounded-b-lg text-xs">
        <div className="space-y-1">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Eingänge</div>
          <div className="relative flex items-center justify-between text-slate-300 py-0.5 pr-1">
            <div className="flex items-center gap-1.5">
              <Handle
                type="target"
                position={Position.Left}
                id="trig"
                className="!w-3 !h-3 !bg-sky-500 !border-2 !border-slate-900 !-left-4"
              />
              <span className="font-mono text-sky-400 font-semibold text-[11px]">TRIG</span>
              <span className="text-[11px]">Taster</span>
            </div>
            <span
              className="text-[10px] bg-slate-800/90 border border-slate-700/60 px-1.5 py-0.5 rounded text-sky-400 font-mono"
              title="KNX Gruppenadresse: Schalten (DPT 1.001)"
            >
              {getGa('trig') || 'Auto'}
            </span>
          </div>
        </div>

        <div className="space-y-1 text-right">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            KNX Ausgänge
          </div>
          <div className="relative flex items-center justify-end gap-1.5 text-slate-300 py-0.5">
            <span className="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-yellow-400 font-mono">
              {getGa('sw') || 'Auto'}
            </span>
            <span className="font-mono text-yellow-400 font-semibold text-[11px]">SW</span>
            <Handle
              type="source"
              position={Position.Right}
              id="sw"
              className="!w-3 !h-3 !bg-yellow-500 !border-2 !border-slate-900 !-right-4"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export const StaircaseBlockNode = memo(StaircaseBlockNodeComponent)
