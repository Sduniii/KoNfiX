import React, { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import { Thermometer, Flame, Plus, Minus, Trash2 } from 'lucide-react'
import { FunctionBlock, GroupAddress } from '../../../types/knx'

interface ClimateBlockNodeProps {
  data: {
    block: FunctionBlock
    groupAddresses: GroupAddress[]
    isSimulating: boolean
    onAction?: (pin: string, value: any) => void
    onDelete?: (blockId: string) => void
  }
}

export const ClimateBlockNodeComponent: React.FC<ClimateBlockNodeProps> = ({ data }) => {
  const { block, groupAddresses, onAction, onDelete } = data
  const targetTemp = block.state?.target_temp ?? 21.0
  const actTemp = block.state?.act_temp ?? 20.8
  const valvePwm = block.state?.valve_pwm ?? 45

  const getGa = (pinId: string) => {
    return groupAddresses.find(
      (ga) => ga.origin_block_id === block.id && ga.origin_pin_name === pinId
    )?.address
  }

  const handleAdjustTemp = (delta: number, e: React.MouseEvent) => {
    e.stopPropagation()
    const newTemp = Math.round((targetTemp + delta) * 10) / 10
    onAction?.('t_set', newTemp)
  }

  return (
    <div className="w-80 rounded-xl border-2 border-slate-700 bg-slate-900 shadow-lg shadow-black/40">
      {/* Node Header */}
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5 bg-slate-800/60 rounded-t-lg">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-orange-500/20 text-orange-400">
            <Flame className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-100">{block.name}</div>
            <div className="text-[10px] text-slate-400 font-mono">Einzelraumregelung</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="text-xs font-mono font-bold text-orange-400 bg-orange-950/60 px-2 py-0.5 rounded border border-orange-800/50">
            Komfort
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

      {/* Temperature Display & Adjuster */}
      <div className="p-4 space-y-3 bg-slate-950/40">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] text-slate-500 uppercase font-bold">Ist-Temperatur</div>
            <div className="text-xl font-mono font-bold text-slate-200 flex items-center gap-1">
              <Thermometer className="w-4 h-4 text-sky-400" />
              {actTemp.toFixed(1)} °C
            </div>
          </div>

          <div className="flex items-center gap-2 bg-slate-800/80 px-2.5 py-1.5 rounded-lg border border-slate-700">
            <button
              onClick={(e) => handleAdjustTemp(-0.5, e)}
              className="p-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <div className="text-center">
              <div className="text-[9px] text-slate-400 font-mono">Soll</div>
              <div className="text-base font-mono font-bold text-orange-400">{targetTemp.toFixed(1)}°</div>
            </div>
            <button
              onClick={(e) => handleAdjustTemp(0.5, e)}
              className="p-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between pt-1 border-t border-slate-800/80 text-[11px] text-slate-400 font-mono">
          <span>Ventilöffnung (PWM):</span>
          <span className="text-orange-400 font-semibold">{valvePwm} %</span>
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
                id="t_act"
                className="!w-3 !h-3 !bg-sky-500 !border-2 !border-slate-900 !-left-4"
              />
              <span className="font-mono text-sky-400 font-semibold text-[11px]">T_IST</span>
              <span className="text-[11px]">Sensor Ist</span>
            </div>
            <span
              className="text-[10px] bg-slate-800/90 border border-slate-700/60 px-1.5 py-0.5 rounded text-sky-400 font-mono"
              title="KNX Gruppenadresse: Ist-Temperatur (DPT 9.001)"
            >
              {getGa('t_act') || 'Auto'}
            </span>
          </div>
        </div>

        {/* Right: Outputs */}
        <div className="space-y-2 text-right">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            KNX Ausgänge (Auto-GA)
          </div>

          <div className="relative flex items-center justify-end gap-1.5 text-slate-300 py-0.5">
            <span className="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-orange-400 font-mono">
              {getGa('t_set') || 'Auto'}
            </span>
            <span className="font-mono text-orange-400 font-semibold text-[11px]">SOLL</span>
            <Handle
              type="source"
              position={Position.Right}
              id="t_set"
              className="!w-3 !h-3 !bg-orange-500 !border-2 !border-slate-900 !-right-4"
            />
          </div>

          <div className="relative flex items-center justify-end gap-1.5 text-slate-300 py-0.5">
            <span className="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-orange-400 font-mono">
              {getGa('heat_val') || 'Auto'}
            </span>
            <span className="font-mono text-orange-400 font-semibold text-[11px]">VENTIL</span>
            <Handle
              type="source"
              position={Position.Right}
              id="heat_val"
              className="!w-3 !h-3 !bg-orange-500 !border-2 !border-slate-900 !-right-4"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export const ClimateBlockNode = memo(ClimateBlockNodeComponent)
