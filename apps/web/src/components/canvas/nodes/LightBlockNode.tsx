import React, { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import { Lightbulb, Sun, Power, Trash2 } from 'lucide-react'
import { FunctionBlock, GroupAddress } from '../../../types/knx'

interface LightBlockNodeProps {
  data: {
    block: FunctionBlock
    groupAddresses: GroupAddress[]
    isSimulating: boolean
    onAction?: (pin: string, value: any) => void
    onDelete?: (blockId: string) => void
  }
}

export const LightBlockNodeComponent: React.FC<LightBlockNodeProps> = ({ data }) => {
  const { block, groupAddresses, isSimulating, onAction, onDelete } = data
  const isOn = block.state?.is_on ?? false
  const brightness = block.state?.brightness ?? (isOn ? 100 : 0)

  // Find linked GAs
  const getGa = (pinId: string) => {
    // 1. Direct match by origin_pin_name
    const direct = groupAddresses.find(
      (ga) => ga.origin_block_id === block.id && ga.origin_pin_name === pinId
    )?.address
    if (direct) return direct

    // 2. Logical inputs T (Toggle) and P (Präsenz) map to sw (Schalten)
    if (pinId === 't' || pinId === 'p') {
      return groupAddresses.find(
        (ga) => ga.origin_block_id === block.id && ga.origin_pin_name === 'sw'
      )?.address
    }

    // 3. Fallback: check pin.group_address_id
    const pin = block.inputs?.find((p) => p.id === pinId)
    if (pin?.group_address_id) {
      return groupAddresses.find((ga) => ga.id === pin.group_address_id)?.address
    }

    return undefined
  }

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    onAction?.('t', !isOn)
  }

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation()
    onAction?.('val', parseInt(e.target.value, 10))
  }

  return (
    <div className={`w-80 rounded-xl border-2 shadow-lg transition-all ${
      isOn
        ? 'border-amber-400 bg-slate-900 shadow-amber-500/10 ring-1 ring-amber-400/40'
        : 'border-slate-700 bg-slate-900 shadow-black/40'
    }`}>
      {/* Node Header */}
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5 bg-slate-800/60 rounded-t-lg">
        <div className="flex items-center gap-2.5">
          <div className={`p-1.5 rounded-lg ${isOn ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-700 text-slate-400'}`}>
            <Lightbulb className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-100 flex items-center gap-1.5">
              {block.name}
            </div>
            <div className="text-[10px] text-slate-400 font-mono">
              Lichtsteuerung (Dimmer)
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleToggle}
            title={isSimulating ? "Klicken zum Schalten (Simulation)" : "Schalten"}
            className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1 transition-all ${
              isOn
                ? 'bg-amber-500 text-slate-950 font-bold shadow-md shadow-amber-500/30 hover:bg-amber-400'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
            }`}
          >
            <Power className="w-3.5 h-3.5" />
            {isOn ? 'AN' : 'AUS'}
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

      {/* Node Body / State Visualizer */}
      <div className="p-4 space-y-3 bg-slate-950/40">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400 flex items-center gap-1">
            <Sun className="w-3.5 h-3.5 text-amber-400" /> Helligkeit
          </span>
          <span className="font-mono font-bold text-slate-200">{brightness} %</span>
        </div>

        <input
          type="range"
          min="0"
          max="100"
          value={brightness}
          onChange={handleSliderChange}
          className="w-full accent-amber-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
        />

        {/* Real-time DPT Indicator */}
        <div className="flex items-center justify-between pt-1 border-t border-slate-800/80 text-[11px] text-slate-400 font-mono">
          <span>DPT 1.001 / 5.001</span>
          <span className="text-amber-400/90 font-semibold">{isOn ? 'Relais Geschlossen' : 'Standby'}</span>
        </div>
      </div>

      {/* Pins / Handles Section */}
      <div className="grid grid-cols-2 p-3 gap-2 border-t border-slate-800 bg-slate-900/80 rounded-b-lg text-xs">
        {/* Left: Inputs */}
        <div className="space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Eingänge
          </div>
          <div className="relative flex items-center justify-between text-slate-300 py-0.5 pr-1">
            <div className="flex items-center gap-1.5">
              <Handle
                type="target"
                position={Position.Left}
                id="t"
                className="!w-3 !h-3 !bg-sky-500 !border-2 !border-slate-900 !-left-4"
              />
              <span className="font-mono text-sky-400 font-semibold text-[11px]">T</span>
              <span className="text-[11px]">Taster</span>
            </div>
            <span
              className="text-[10px] bg-slate-800/90 border border-slate-700/60 px-1.5 py-0.5 rounded text-sky-400 font-mono"
              title="KNX Gruppenadresse: Schalten (DPT 1.001)"
            >
              {getGa('t') || 'Auto'}
            </span>
          </div>

          <div className="relative flex items-center justify-between text-slate-300 py-0.5 pr-1">
            <div className="flex items-center gap-1.5">
              <Handle
                type="target"
                position={Position.Left}
                id="p"
                className="!w-3 !h-3 !bg-sky-500 !border-2 !border-slate-900 !-left-4"
              />
              <span className="font-mono text-sky-400 font-semibold text-[11px]">P</span>
              <span className="text-[11px]">Präsenz</span>
            </div>
            <span
              className="text-[10px] bg-slate-800/90 border border-slate-700/60 px-1.5 py-0.5 rounded text-sky-400 font-mono"
              title="KNX Gruppenadresse: Schalten / Präsenz"
            >
              {getGa('p') || 'Auto'}
            </span>
          </div>
        </div>

        {/* Right: Outputs */}
        <div className="space-y-2 text-right">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            KNX Ausgänge (Auto-GA)
          </div>

          <div className="relative flex items-center justify-end gap-1.5 text-slate-300 py-0.5">
            <span className="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-emerald-400 font-mono">
              {getGa('sw') || 'Auto'}
            </span>
            <span className="font-mono text-emerald-400 font-semibold text-[11px]">SW</span>
            <Handle
              type="source"
              position={Position.Right}
              id="sw"
              className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-slate-900 !-right-4"
            />
          </div>

          <div className="relative flex items-center justify-end gap-1.5 text-slate-300 py-0.5">
            <span className="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-emerald-400 font-mono">
              {getGa('val') || 'Auto'}
            </span>
            <span className="font-mono text-emerald-400 font-semibold text-[11px]">VAL</span>
            <Handle
              type="source"
              position={Position.Right}
              id="val"
              className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-slate-900 !-right-4"
            />
          </div>

          <div className="relative flex items-center justify-end gap-1.5 text-slate-300 py-0.5">
            <span className="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-indigo-400 font-mono">
              {getGa('stat_sw') || 'Auto'}
            </span>
            <span className="font-mono text-indigo-400 font-semibold text-[11px]">STAT</span>
            <Handle
              type="source"
              position={Position.Right}
              id="stat_sw"
              className="!w-3 !h-3 !bg-indigo-500 !border-2 !border-slate-900 !-right-4"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export const LightBlockNode = memo(LightBlockNodeComponent)
