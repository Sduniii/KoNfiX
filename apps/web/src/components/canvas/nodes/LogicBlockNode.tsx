import React, { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import { Binary, CheckCircle2, XCircle, Trash2 } from 'lucide-react'
import { FunctionBlock, GroupAddress } from '../../../types/knx'

interface LogicBlockNodeProps {
  data: {
    block: FunctionBlock
    groupAddresses: GroupAddress[]
    isSimulating: boolean
    onAction?: (pin: string, value: any) => void
    onDelete?: (blockId: string) => void
  }
}

export const LogicBlockNodeComponent: React.FC<LogicBlockNodeProps> = ({ data }) => {
  const { block, groupAddresses, onAction, onDelete } = data
  const gateType = block.parameters?.gate_type ?? 'AND'
  const in1 = block.state?.in1 ?? false
  const in2 = block.state?.in2 ?? false
  const out = block.state?.out ?? (gateType === 'AND' ? in1 && in2 : in1 || in2)

  const getGa = (pinId: string) => {
    return groupAddresses.find(
      (ga) => ga.origin_block_id === block.id && ga.origin_pin_name === pinId
    )?.address
  }

  const toggleIn1 = (e: React.MouseEvent) => {
    e.stopPropagation()
    onAction?.('in1', !in1)
  }

  const toggleIn2 = (e: React.MouseEvent) => {
    e.stopPropagation()
    onAction?.('in2', !in2)
  }

  return (
    <div className={`w-80 rounded-xl border-2 shadow-lg transition-all ${
      out
        ? 'border-emerald-400 bg-slate-900 shadow-emerald-500/10'
        : 'border-slate-700 bg-slate-900 shadow-black/40'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5 bg-slate-800/60 rounded-t-lg">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-pink-500/20 text-pink-400">
            <Binary className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-100">{block.name}</div>
            <div className="text-[10px] text-slate-400 font-mono">Logikgatter ({gateType})</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={`px-2 py-0.5 rounded text-xs font-mono font-bold border ${
            out
              ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
              : 'bg-slate-800 text-slate-400 border-slate-700'
          }`}>
            OUT: {out ? '1' : '0'}
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

      {/* Interactive Input Toggles */}
      <div className="p-3.5 space-y-2.5 bg-slate-950/50">
        <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500">
          Eingangssignale simulieren
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={toggleIn1}
            className={`p-2 rounded-lg border flex items-center justify-between text-xs transition-all ${
              in1
                ? 'bg-emerald-950/60 border-emerald-500 text-emerald-300 font-semibold'
                : 'bg-slate-800/60 border-slate-700 text-slate-400'
            }`}
          >
            <span>In 1</span>
            {in1 ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <XCircle className="w-3.5 h-3.5 text-slate-600" />}
          </button>

          <button
            onClick={toggleIn2}
            className={`p-2 rounded-lg border flex items-center justify-between text-xs transition-all ${
              in2
                ? 'bg-emerald-950/60 border-emerald-500 text-emerald-300 font-semibold'
                : 'bg-slate-800/60 border-slate-700 text-slate-400'
            }`}
          >
            <span>In 2</span>
            {in2 ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <XCircle className="w-3.5 h-3.5 text-slate-600" />}
          </button>
        </div>
      </div>

      {/* Handles */}
      <div className="grid grid-cols-2 p-3 gap-2 border-t border-slate-800 bg-slate-900/80 rounded-b-lg text-xs">
        <div className="space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Eingänge</div>
          <div className="relative flex items-center justify-between text-slate-300 py-0.5 pr-1">
            <div className="flex items-center gap-1.5">
              <Handle
                type="target"
                position={Position.Left}
                id="in1"
                className="!w-3 !h-3 !bg-sky-500 !border-2 !border-slate-900 !-left-4"
              />
              <span className="font-mono text-sky-400 font-semibold text-[11px]">IN1</span>
              <span className="text-[11px]">Eingang 1</span>
            </div>
            <span
              className="text-[10px] bg-slate-800/90 border border-slate-700/60 px-1.5 py-0.5 rounded text-sky-400 font-mono"
              title="Logikeingang 1"
            >
              {getGa('in1') || 'Auto'}
            </span>
          </div>

          <div className="relative flex items-center justify-between text-slate-300 py-0.5 pr-1">
            <div className="flex items-center gap-1.5">
              <Handle
                type="target"
                position={Position.Left}
                id="in2"
                className="!w-3 !h-3 !bg-sky-500 !border-2 !border-slate-900 !-left-4"
              />
              <span className="font-mono text-sky-400 font-semibold text-[11px]">IN2</span>
              <span className="text-[11px]">Eingang 2</span>
            </div>
            <span
              className="text-[10px] bg-slate-800/90 border border-slate-700/60 px-1.5 py-0.5 rounded text-sky-400 font-mono"
              title="Logikeingang 2"
            >
              {getGa('in2') || 'Auto'}
            </span>
          </div>
        </div>

        <div className="space-y-1 text-right">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            KNX Ausgang
          </div>
          <div className="relative flex items-center justify-end gap-1.5 text-slate-300 py-0.5">
            <span className="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-emerald-400 font-mono">
              {getGa('out') || 'Auto'}
            </span>
            <span className="font-mono text-emerald-400 font-semibold text-[11px]">OUT</span>
            <Handle
              type="source"
              position={Position.Right}
              id="out"
              className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-slate-900 !-right-4"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export const LogicBlockNode = memo(LogicBlockNodeComponent)
