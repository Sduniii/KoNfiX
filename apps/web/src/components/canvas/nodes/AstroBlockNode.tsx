import React, { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import { SunMedium, Compass, Wind, CloudRain, Sun, AlertTriangle, ShieldAlert, Trash2 } from 'lucide-react'
import { FunctionBlock, GroupAddress } from '../../../types/knx'

interface AstroBlockNodeProps {
  data: {
    block: FunctionBlock
    groupAddresses: GroupAddress[]
    isSimulating: boolean
    onAction?: (pin: string, value: any) => void
    onDelete?: (blockId: string) => void
  }
}

export const AstroBlockNodeComponent: React.FC<AstroBlockNodeProps> = ({ data }) => {
  const { block, groupAddresses, onAction, onDelete } = data

  const state = block.state || {}
  const isWindAlarm = state.is_wind_alarm ?? false
  const isSunProtecting = state.is_sun_protecting ?? false
  const windSpeed = state.wind_speed ?? 3.2
  const rain = state.rain ?? false
  const lux = state.brightness ?? 42000
  const temp = state.temp ?? 22.4
  const azimuth = state.calculated_azimuth ?? 183.4
  const elevation = state.calculated_elevation ?? 60.9
  const solarDir = state.solar_direction ?? 'Süd (S)'
  const targetPos = state.target_pos ?? 0

  const getGa = (pinId: string) => {
    return groupAddresses.find(
      (ga) => ga.origin_block_id === block.id && ga.origin_pin_name === pinId
    )?.address
  }

  return (
    <div
      className={`w-96 rounded-2xl border-2 shadow-xl transition-all ${
        isWindAlarm
          ? 'border-red-500 bg-slate-900 shadow-red-500/20'
          : isSunProtecting
          ? 'border-amber-400 bg-slate-900 shadow-amber-500/10'
          : 'border-slate-700 bg-slate-900 shadow-black/40'
      }`}
    >
      {/* Header */}
      <div
        className={`flex items-center justify-between border-b px-4 py-3 rounded-t-2xl ${
          isWindAlarm
            ? 'bg-red-950/60 border-red-800'
            : isSunProtecting
            ? 'bg-amber-950/40 border-amber-900/50'
            : 'bg-slate-800/60 border-slate-800'
        }`}
      >
        <div className="flex items-center gap-2.5">
          <div
            className={`p-2 rounded-xl ${
              isWindAlarm
                ? 'bg-red-500/20 text-red-400 animate-pulse'
                : isSunProtecting
                ? 'bg-amber-500/20 text-amber-400'
                : 'bg-sky-500/20 text-sky-400'
            }`}
          >
            <Compass className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-bold text-slate-100">{block.name}</div>
            <div className="text-[11px] text-slate-400 font-mono flex items-center gap-1.5">
              <span>Astro-Sonnenschutz & Wetter</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isWindAlarm ? (
            <div className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-red-900/80 text-red-200 border border-red-700 animate-pulse">
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>WINDALARM</span>
            </div>
          ) : isSunProtecting ? (
            <div className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-950/80 text-amber-300 border border-amber-700">
              <SunMedium className="w-3.5 h-3.5 text-amber-400" />
              <span>BESCHATTUNG</span>
            </div>
          ) : (
            <div className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-slate-800 text-slate-400 border border-slate-700">
              Standby
            </div>
          )}

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

      {/* Solar Position Radar & Live Weather Metrics */}
      <div className="p-4 space-y-3.5 bg-slate-950/40">
        {/* Sun Coordinates */}
        <div className="grid grid-cols-3 gap-2 bg-slate-900/80 p-2.5 rounded-xl border border-slate-800 text-center">
          <div>
            <div className="text-[10px] text-slate-400 uppercase font-semibold">Azimut</div>
            <div className="text-sm font-bold text-amber-400 font-mono mt-0.5">{azimuth}°</div>
            <div className="text-[9px] text-slate-500">{solarDir}</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-400 uppercase font-semibold">Elevation</div>
            <div className="text-sm font-bold text-sky-400 font-mono mt-0.5">{elevation}°</div>
            <div className="text-[9px] text-slate-500">über Horizont</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-400 uppercase font-semibold">Soll-Position</div>
            <div className="text-sm font-bold text-emerald-400 font-mono mt-0.5">{targetPos}%</div>
            <div className="text-[9px] text-slate-500">Behanghöhe</div>
          </div>
        </div>

        {/* Live Weather Metrics (Bresser 7in1 Integration) */}
        <div>
          <div className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-2 flex items-center justify-between">
            <span>Bresser Wetterstation</span>
            <span className="text-emerald-400 font-mono text-[9px]">GAs 0/0/1 - 0/0/9</span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {/* Wind */}
            <div className={`p-2 rounded-xl border flex items-center justify-between ${
              isWindAlarm ? 'bg-red-950/40 border-red-700 text-red-300' : 'bg-slate-900/60 border-slate-800 text-slate-300'
            }`}>
              <div className="flex items-center gap-1.5">
                <Wind className="w-3.5 h-3.5 text-sky-400" />
                <span className="text-xs">Wind</span>
              </div>
              <span className="font-mono text-xs font-bold">{windSpeed.toFixed(1)} m/s</span>
            </div>

            {/* Brightness */}
            <div className="p-2 rounded-xl border border-slate-800 bg-slate-900/60 flex items-center justify-between text-slate-300">
              <div className="flex items-center gap-1.5">
                <Sun className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-xs">Helligkeit</span>
              </div>
              <span className="font-mono text-xs font-bold">{(lux / 1000).toFixed(0)}k Lux</span>
            </div>

            {/* Rain */}
            <div className={`p-2 rounded-xl border flex items-center justify-between ${
              rain ? 'bg-blue-950/50 border-blue-700 text-blue-300' : 'bg-slate-900/60 border-slate-800 text-slate-300'
            }`}>
              <div className="flex items-center gap-1.5">
                <CloudRain className="w-3.5 h-3.5 text-blue-400" />
                <span className="text-xs">Regen</span>
              </div>
              <span className="font-mono text-xs font-bold">{rain ? 'Ja' : 'Nein'}</span>
            </div>

            {/* Temp */}
            <div className="p-2 rounded-xl border border-slate-800 bg-slate-900/60 flex items-center justify-between text-slate-300">
              <div className="flex items-center gap-1.5">
                <span className="text-xs">🌡️ Temp</span>
              </div>
              <span className="font-mono text-xs font-bold">{temp.toFixed(1)} °C</span>
            </div>
          </div>
        </div>

        {/* Test Trigger Button */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onAction?.('wind_speed', isWindAlarm ? 3.0 : 16.0)
            }}
            className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-all flex items-center justify-center gap-1.5 ${
              isWindAlarm
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-600 text-slate-200'
                : 'bg-red-950/50 hover:bg-red-900/60 border-red-700 text-red-300'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>{isWindAlarm ? 'Wind normalisieren' : 'Sturm-Test (16 m/s)'}</span>
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation()
              onAction?.('brightness', isSunProtecting ? 15000 : 55000)
            }}
            className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-all flex items-center justify-center gap-1.5 ${
              isSunProtecting
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-600 text-slate-200'
                : 'bg-amber-950/50 hover:bg-amber-900/60 border-amber-700 text-amber-300'
            }`}
          >
            <Sun className="w-3.5 h-3.5" />
            <span>{isSunProtecting ? 'Wolke (15k Lux)' : 'Sonne (55k Lux)'}</span>
          </button>
        </div>
      </div>

      {/* Handles & Pin Labels */}
      <div className="border-t border-slate-800/80 px-4 py-3 bg-slate-950/60 rounded-b-2xl">
        <div className="flex justify-between text-xs">
          {/* Inputs */}
          <div className="space-y-2.5">
            <div className="relative flex items-center gap-2">
              <Handle
                type="target"
                position={Position.Left}
                id="wind_speed"
                className="!w-3 !h-3 !bg-sky-400 !border-2 !border-slate-900"
              />
              <span className="text-slate-300 font-mono text-[11px] pl-1">wind_speed</span>
            </div>

            <div className="relative flex items-center gap-2">
              <Handle
                type="target"
                position={Position.Left}
                id="brightness"
                className="!w-3 !h-3 !bg-amber-400 !border-2 !border-slate-900"
              />
              <span className="text-slate-300 font-mono text-[11px] pl-1">brightness (lux)</span>
            </div>

            <div className="relative flex items-center gap-2">
              <Handle
                type="target"
                position={Position.Left}
                id="rain"
                className="!w-3 !h-3 !bg-blue-400 !border-2 !border-slate-900"
              />
              <span className="text-slate-300 font-mono text-[11px] pl-1">rain</span>
            </div>

            <div className="relative flex items-center gap-2">
              <Handle
                type="target"
                position={Position.Left}
                id="lock"
                className="!w-3 !h-3 !bg-slate-400 !border-2 !border-slate-900"
              />
              <span className="text-slate-300 font-mono text-[11px] pl-1">lock</span>
            </div>
          </div>

          {/* Outputs */}
          <div className="space-y-2.5 text-right">
            <div className="relative flex items-center justify-end gap-2">
              <span className="text-slate-300 font-mono text-[11px] pr-1">wind_alarm</span>
              {getGa('wind_alarm') && (
                <span className="text-[9px] font-mono text-red-400 mr-1">{getGa('wind_alarm')}</span>
              )}
              <Handle
                type="source"
                position={Position.Right}
                id="wind_alarm"
                className="!w-3 !h-3 !bg-red-400 !border-2 !border-slate-900"
              />
            </div>

            <div className="relative flex items-center justify-end gap-2">
              <span className="text-slate-300 font-mono text-[11px] pr-1">sun_active</span>
              {getGa('sun_active') && (
                <span className="text-[9px] font-mono text-amber-400 mr-1">{getGa('sun_active')}</span>
              )}
              <Handle
                type="source"
                position={Position.Right}
                id="sun_active"
                className="!w-3 !h-3 !bg-amber-400 !border-2 !border-slate-900"
              />
            </div>

            <div className="relative flex items-center justify-end gap-2">
              <span className="text-slate-300 font-mono text-[11px] pr-1">target_pos %</span>
              {getGa('target_pos') && (
                <span className="text-[9px] font-mono text-emerald-400 mr-1">{getGa('target_pos')}</span>
              )}
              <Handle
                type="source"
                position={Position.Right}
                id="target_pos"
                className="!w-3 !h-3 !bg-emerald-400 !border-2 !border-slate-900"
              />
            </div>

            <div className="relative flex items-center justify-end gap-2">
              <span className="text-slate-300 font-mono text-[11px] pr-1">target_blade %</span>
              <Handle
                type="source"
                position={Position.Right}
                id="target_blade"
                className="!w-3 !h-3 !bg-teal-400 !border-2 !border-slate-900"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export const AstroBlockNode = memo(AstroBlockNodeComponent)
