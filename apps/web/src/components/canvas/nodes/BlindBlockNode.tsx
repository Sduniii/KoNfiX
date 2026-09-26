import React, { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import { ArrowUp, ArrowDown, Square, Trash2 } from 'lucide-react'
import { FunctionBlock, GroupAddress } from '../../../types/knx'

interface BlindBlockNodeProps {
  data: {
    block: FunctionBlock
    groupAddresses: GroupAddress[]
    isSimulating: boolean
    onAction?: (pin: string, value: any) => void
    onDelete?: (blockId: string) => void
  }
}

export const BlindBlockNodeComponent: React.FC<BlindBlockNodeProps> = ({ data }) => {
  const { block, groupAddresses, onAction, onDelete } = data
  const position = block.state?.position ?? 0

  const getGa = (pinId: string) => {
    // 1. Direct match by origin_pin_name
    const direct = groupAddresses.find(
      (ga) => ga.origin_block_id === block.id && ga.origin_pin_name === pinId
    )?.address
    if (direct) return direct

    // 2. Map logical input pins to corresponding group addresses
    if (pinId === 'up' || pinId === 'down') {
      return groupAddresses.find(
        (ga) => ga.origin_block_id === block.id && ga.origin_pin_name === 'move'
      )?.address
    }
    if (pinId === 'step' || pinId === 'stop') {
      return groupAddresses.find(
        (ga) => ga.origin_block_id === block.id && ga.origin_pin_name === 'step_stop'
      )?.address
    }

    // 3. Fallback: check pin.group_address_id
    const pin = block.inputs?.find((p) => p.id === pinId)
    if (pin?.group_address_id) {
      return groupAddresses.find((ga) => ga.id === pin.group_address_id)?.address
    }

    return undefined
  }

  const handleUp = (e: React.MouseEvent) => {
    e.stopPropagation()
    onAction?.('up', 0)
  }

  const handleDown = (e: React.MouseEvent) => {
    e.stopPropagation()
    onAction?.('down', 100)
  }

  const handleStop = (e: React.MouseEvent) => {
    e.stopPropagation()
    onAction?.('step_stop', 0)
  }

  return (
    <div className="w-80 rounded-xl border-2 border-slate-700 bg-slate-900 shadow-lg shadow-black/40">
      {/* Node Header */}
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5 bg-slate-800/60 rounded-t-lg">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-teal-500/20 text-teal-400">
            <div className="flex flex-col gap-0.5 w-4 h-4 justify-center items-center">
              <div className="w-4 h-0.5 bg-teal-400 rounded"></div>
              <div className="w-4 h-0.5 bg-teal-400 rounded"></div>
              <div className="w-4 h-0.5 bg-teal-400 rounded"></div>
            </div>
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-100">{block.name}</div>
            <div className="text-[10px] text-slate-400 font-mono">Automatikjalousie</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="text-xs font-mono font-bold text-teal-400 bg-teal-950/60 px-2 py-0.5 rounded border border-teal-800/50">
            {position} %
          </div>
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

      {/* Visual Blind Preview & Quick Buttons */}
      <div className="p-4 space-y-3 bg-slate-950/40">
        <div className="flex items-center justify-between">
          {/* Animated Blind graphic */}
          <div className="w-24 h-16 bg-slate-800 rounded border border-slate-700 p-1 flex flex-col justify-between overflow-hidden relative">
            <div
              className="absolute top-0 left-0 right-0 bg-teal-500/30 border-b border-teal-400/80 transition-all duration-300"
              style={{ height: `${position}%` }}
            />
            <div className="z-10 text-[9px] text-center text-slate-400 font-mono">
              {position === 0 ? 'Geöffnet' : position === 100 ? 'Geschlossen' : `${position}% Beschattet`}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-1.5">
            <button
              onClick={handleUp}
              title="Auf (0%)"
              className="p-2 rounded bg-slate-800 hover:bg-teal-600 hover:text-white text-slate-300 transition-colors"
            >
              <ArrowUp className="w-4 h-4" />
            </button>
            <button
              onClick={handleStop}
              title="Stop"
              className="p-2 rounded bg-slate-800 hover:bg-amber-600 hover:text-white text-slate-300 transition-colors"
            >
              <Square className="w-4 h-4" />
            </button>
            <button
              onClick={handleDown}
              title="Ab (100%)"
              className="p-2 rounded bg-slate-800 hover:bg-teal-600 hover:text-white text-slate-300 transition-colors"
            >
              <ArrowDown className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between pt-1 border-t border-slate-800/80 text-[11px] text-slate-400 font-mono">
          <span>DPT 1.008 / 1.010 / 5.001</span>
          <span className="text-teal-400">Lamelle: 45°</span>
        </div>
      </div>

      {/* Handles */}
      <div className="grid grid-cols-2 p-3 gap-2 border-t border-slate-800 bg-slate-900/80 rounded-b-lg text-xs">
        {/* Left: Inputs */}
        <div className="space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Eingänge</div>
          <div className="relative flex items-center justify-between text-slate-300 py-0.5 pr-1">
            <div className="flex items-center gap-1.5">
              <Handle
                type="target"
                position={Position.Left}
                id="up"
                className="!w-3 !h-3 !bg-sky-500 !border-2 !border-slate-900 !-left-4"
              />
              <span className="font-mono text-sky-400 font-semibold text-[11px]">AUF</span>
              <span className="text-[11px]">Aufwärts</span>
            </div>
            <span
              className="text-[10px] bg-slate-800/90 border border-slate-700/60 px-1.5 py-0.5 rounded text-sky-400 font-mono"
              title="KNX Gruppenadresse: Auf/Ab (0 = Auf)"
            >
              {getGa('up') || 'Auto'}
            </span>
          </div>

          <div className="relative flex items-center justify-between text-slate-300 py-0.5 pr-1">
            <div className="flex items-center gap-1.5">
              <Handle
                type="target"
                position={Position.Left}
                id="down"
                className="!w-3 !h-3 !bg-sky-500 !border-2 !border-slate-900 !-left-4"
              />
              <span className="font-mono text-sky-400 font-semibold text-[11px]">AB</span>
              <span className="text-[11px]">Abwärts</span>
            </div>
            <span
              className="text-[10px] bg-slate-800/90 border border-slate-700/60 px-1.5 py-0.5 rounded text-sky-400 font-mono"
              title="KNX Gruppenadresse: Auf/Ab (1 = Ab)"
            >
              {getGa('down') || 'Auto'}
            </span>
          </div>

          <div className="relative flex items-center justify-between text-slate-300 py-0.5 pr-1">
            <div className="flex items-center gap-1.5">
              <Handle
                type="target"
                position={Position.Left}
                id="in-pos"
                className="!w-3 !h-3 !bg-teal-400 !border-2 !border-slate-900 !-left-4"
              />
              <span className="font-mono text-teal-400 font-semibold text-[11px]">POS</span>
              <span className="text-[11px]">Soll-Pos</span>
            </div>
            <span className="text-[10px] text-slate-500 font-mono">0-100%</span>
          </div>

          <div className="relative flex items-center justify-between text-slate-300 py-0.5 pr-1">
            <div className="flex items-center gap-1.5">
              <Handle
                type="target"
                position={Position.Left}
                id="alarm"
                className="!w-3 !h-3 !bg-rose-500 !border-2 !border-slate-900 !-left-4"
              />
              <span className="font-mono text-rose-400 font-semibold text-[11px]">ALARM</span>
              <span className="text-[11px]">Windalarm</span>
            </div>
            <span className="text-[10px] text-rose-400/80 font-mono">DPT 1.005</span>
          </div>
        </div>

        {/* Right: Outputs */}
        <div className="space-y-2 text-right">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            KNX Ausgänge (Auto-GA)
          </div>

          <div className="relative flex items-center justify-end gap-1.5 text-slate-300 py-0.5">
            <span className="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-teal-400 font-mono">
              {getGa('move') || 'Auto'}
            </span>
            <span className="font-mono text-teal-400 font-semibold text-[11px]">MOVE</span>
            <Handle
              type="source"
              position={Position.Right}
              id="move"
              className="!w-3 !h-3 !bg-teal-500 !border-2 !border-slate-900 !-right-4"
            />
          </div>

          <div className="relative flex items-center justify-end gap-1.5 text-slate-300 py-0.5">
            <span className="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-teal-400 font-mono">
              {getGa('step_stop') || 'Auto'}
            </span>
            <span className="font-mono text-teal-400 font-semibold text-[11px]">STOP</span>
            <Handle
              type="source"
              position={Position.Right}
              id="step_stop"
              className="!w-3 !h-3 !bg-teal-500 !border-2 !border-slate-900 !-right-4"
            />
          </div>

          <div className="relative flex items-center justify-end gap-1.5 text-slate-300 py-0.5">
            <span className="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-teal-400 font-mono">
              {getGa('pos') || 'Auto'}
            </span>
            <span className="font-mono text-teal-400 font-semibold text-[11px]">POS</span>
            <Handle
              type="source"
              position={Position.Right}
              id="pos"
              className="!w-3 !h-3 !bg-teal-500 !border-2 !border-slate-900 !-right-4"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export const BlindBlockNode = memo(BlindBlockNodeComponent)
