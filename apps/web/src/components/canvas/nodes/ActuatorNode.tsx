import React from 'react'
import { Handle, Position } from '@xyflow/react'
import { Cpu } from 'lucide-react'

interface ActuatorNodeProps {
  data: {
    deviceAddress: string
    channelCode: string
    name: string
    deviceName: string
    channelType: string
    gaAddress?: string
  }
}

export const ActuatorNode: React.FC<ActuatorNodeProps> = ({ data }) => {
  const { deviceAddress, channelCode, name, deviceName, channelType, gaAddress } = data

  return (
    <div className="w-56 rounded-lg border border-emerald-500/50 bg-slate-900/90 shadow-lg shadow-emerald-950/40 p-3">
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
        <div className="flex items-center gap-1.5">
          <Cpu className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-semibold text-slate-200">Aktor-Kanal</span>
        </div>
        <span className="text-[10px] font-mono bg-emerald-950/80 border border-emerald-800/40 text-emerald-300 px-1.5 py-0.5 rounded">
          {deviceAddress}
        </span>
      </div>

      <div className="mb-2">
        <div className="text-xs font-medium text-slate-100">{name}</div>
        <div className="text-[10px] text-slate-400 font-mono">{channelCode} • {deviceName}</div>
      </div>

      <div className="py-1 px-2 rounded bg-emerald-950/40 border border-emerald-800/30 text-[10px] font-mono text-emerald-400 flex items-center justify-between">
        <span>Typ:</span>
        <span className="font-semibold">{channelType}</span>
      </div>

      <div className="relative flex items-center justify-between mt-2 text-[10px] text-slate-400 font-mono">
        <div className="flex items-center gap-1">
          <Handle
            type="target"
            position={Position.Left}
            id="in"
            className="!w-2.5 !h-2.5 !bg-emerald-400 !border-2 !border-slate-900 !-left-4"
          />
          <span>KNX Last (Eingang)</span>
        </div>
        {gaAddress && (
          <span
            className="text-[9px] font-mono text-emerald-400 bg-emerald-950/80 px-1 py-0.5 rounded border border-emerald-800/40"
            title={`Verknüpfte KNX Gruppenadresse: ${gaAddress}`}
          >
            {gaAddress}
          </span>
        )}
      </div>
    </div>
  )
}
