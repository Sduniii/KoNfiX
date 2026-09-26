import React, { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import { Palette, Check, Trash2, Sliders, Play, VolumeX, Lightbulb } from 'lucide-react'
import { FunctionBlock, GroupAddress, SceneDefinition, LightCircuit } from '../../../types/knx'

interface SceneBlockNodeProps {
  data: {
    block: FunctionBlock
    groupAddresses: GroupAddress[]
    isSimulating: boolean
    onAction?: (pin: string, value: any) => void
    onDelete?: (blockId: string) => void
    onOpenMixer?: (block: FunctionBlock) => void
  }
}

const DEFAULT_CIRCUITS: LightCircuit[] = [
  { id: 'c1', name: 'Decke', type: 'dimmer', color: '#f59e0b' },
  { id: 'c2', name: 'Wand', type: 'dimmer', color: '#ec4899' },
  { id: 'c3', name: 'Indirekt', type: 'dimmer', color: '#8b5cf6' },
  { id: 'c4', name: 'Esstisch', type: 'dimmer', color: '#06b6d4' },
]

const DEFAULT_SCENES: SceneDefinition[] = [
  { no: 1, name: 'Normal / Hell', icon: '☀️', values: { c1: 90, c2: 70, c3: 80, c4: 85 } },
  { no: 2, name: 'Kochen / Essen', icon: '🍳', values: { c1: 100, c2: 80, c3: 40, c4: 100 } },
  { no: 3, name: 'TV / Relax', icon: '🍿', values: { c1: 0, c2: 25, c3: 45, c4: 0 } },
  { no: 4, name: 'Nacht / Orientierung', icon: '🌙', values: { c1: 0, c2: 10, c3: 15, c4: 0 } },
  { no: 5, name: 'Alles Aus', icon: '🌑', values: { c1: 0, c2: 0, c3: 0, c4: 0 } },
]

export const SceneBlockNodeComponent: React.FC<SceneBlockNodeProps> = ({ data }) => {
  const { block, groupAddresses, onAction, onDelete, onOpenMixer } = data
  const activeSceneNo = block.state?.active_scene ?? 1
  const circuits: LightCircuit[] = block.parameters?.circuits || DEFAULT_CIRCUITS
  const scenes: SceneDefinition[] = block.parameters?.scenes || DEFAULT_SCENES
  const faderValues: Record<string, number> = block.state?.fader_values || {}

  const activeScene = scenes.find((s) => s.no === activeSceneNo) || scenes[0]

  const getGa = (pinId: string) => {
    const direct = groupAddresses.find(
      (ga) => ga.origin_block_id === block.id && ga.origin_pin_name === pinId
    )?.address
    if (direct) return direct

    if (pinId === 'trig') {
      return groupAddresses.find(
        (ga) => ga.origin_block_id === block.id && ga.origin_pin_name === 'scene_ctrl'
      )?.address
    }

    return undefined
  }

  const handleSelectScene = (sceneNo: number, e: React.MouseEvent) => {
    e.stopPropagation()
    onAction?.('scene', sceneNo)
  }

  return (
    <div className="w-84 rounded-xl border-2 border-purple-600/70 bg-slate-900 shadow-xl shadow-purple-950/20 overflow-visible">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5 bg-gradient-to-r from-slate-900 via-purple-950/30 to-slate-900 rounded-t-lg">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-purple-500/20 text-purple-400 border border-purple-500/30">
            <Palette className="w-4 h-4" />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-100">{block.name}</div>
            <div className="text-[10px] text-purple-400 font-mono">
              Lichtsteuerung & Szenen (DPT 18.001)
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-mono bg-purple-950/80 text-purple-300 border border-purple-700/50 px-2 py-0.5 rounded-full flex items-center gap-1">
            <span>{activeScene?.icon || '✨'}</span>
            <span>Szene {activeSceneNo}</span>
          </span>
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

      {/* Interactive Scene Buttons (Stimmungen) */}
      <div className="p-3 space-y-2 bg-slate-950/60">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400">
            Stimmungen / Szenen
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onOpenMixer?.(block)
            }}
            className="flex items-center gap-1 text-[11px] font-semibold text-purple-300 hover:text-purple-200 bg-purple-900/40 hover:bg-purple-800/50 border border-purple-700/60 px-2 py-0.5 rounded-lg transition-colors"
          >
            <Sliders className="w-3 h-3" />
            <span>Mischpult</span>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          {scenes.slice(0, 4).map((sc) => {
            const isActive = activeSceneNo === sc.no
            return (
              <button
                key={sc.no}
                onClick={(e) => handleSelectScene(sc.no, e)}
                className={`flex items-center gap-2 p-1.5 rounded-lg border text-left transition-all ${
                  isActive
                    ? 'bg-purple-600/30 border-purple-400 text-purple-200 font-semibold shadow-md shadow-purple-900/30'
                    : 'bg-slate-800/60 border-slate-700/70 text-slate-300 hover:bg-slate-800'
                }`}
              >
                <span className="text-sm shrink-0">{sc.icon}</span>
                <div className="flex-1 truncate text-xs">{sc.name}</div>
                {isActive && <Check className="w-3 h-3 text-purple-400 shrink-0" />}
              </button>
            )
          })}
        </div>

        {/* Alles Aus Button / 5th scene quick action */}
        {scenes.length > 4 && (
          <button
            onClick={(e) => handleSelectScene(scenes[scenes.length - 1].no, e)}
            className={`w-full flex items-center justify-center gap-1.5 py-1 px-2 rounded-lg border text-xs transition-all ${
              activeSceneNo === scenes[scenes.length - 1].no
                ? 'bg-rose-950/60 border-rose-600 text-rose-200 font-bold'
                : 'bg-slate-900/80 hover:bg-rose-950/30 border-slate-800 hover:border-rose-900 text-slate-400 hover:text-rose-300'
            }`}
          >
            <VolumeX className="w-3 h-3" />
            <span>{scenes[scenes.length - 1].name}</span>
          </button>
        )}
      </div>

      {/* Mini-Mixer Visual (Current Channel Level Overview) */}
      <div className="p-3 bg-slate-900/80 border-t border-slate-800/80">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Lichtkreise Pegel ({activeScene?.name})
          </span>
          <span className="text-[10px] font-mono text-purple-400">
            {circuits.length} Kanäle
          </span>
        </div>

        <div className="grid grid-cols-4 gap-1.5">
          {circuits.map((circ) => {
            const val = faderValues[circ.id] ?? activeScene?.values?.[circ.id] ?? 0
            const isOn = val > 0
            return (
              <div
                key={circ.id}
                className="bg-slate-950/70 rounded-lg p-1.5 border border-slate-800 flex flex-col items-center"
              >
                <div className="flex items-center justify-between w-full text-[9px] text-slate-400 truncate mb-1">
                  <span className="truncate" title={circ.name}>
                    {circ.name.slice(0, 5)}
                  </span>
                  <div
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{
                      backgroundColor: isOn ? circ.color || '#a855f7' : '#475569',
                    }}
                  />
                </div>

                {/* Vertical mini meter bar */}
                <div className="w-full h-8 bg-slate-900 rounded flex flex-col justify-end p-0.5 overflow-hidden">
                  <div
                    className="w-full rounded-sm transition-all duration-200"
                    style={{
                      height: `${val}%`,
                      backgroundColor: circ.color || '#a855f7',
                    }}
                  />
                </div>

                <span className="text-[9px] font-mono font-bold text-slate-300 mt-1">
                  {val}%
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Handles: Inputs & Outputs */}
      <div className="grid grid-cols-2 p-3 gap-2 border-t border-slate-800 bg-slate-950/90 rounded-b-xl text-xs">
        {/* Left: Inputs */}
        <div className="space-y-1.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Eingänge
          </div>

          <div className="relative flex items-center justify-between text-slate-300 py-0.5 pr-1">
            <div className="flex items-center gap-1.5">
              <Handle
                type="target"
                position={Position.Left}
                id="trig"
                className="!w-3 !h-3 !bg-sky-500 !border-2 !border-slate-900 !-left-4"
              />
              <span className="font-mono text-sky-400 font-semibold text-[11px]">TRIG</span>
              <span className="text-[11px]">Weiter</span>
            </div>
            <span
              className="text-[10px] bg-slate-800/90 border border-slate-700/60 px-1.5 py-0.5 rounded text-sky-400 font-mono"
              title="KNX Gruppenadresse: Weiterschalten (DPT 1.001)"
            >
              {getGa('trig') || 'Auto'}
            </span>
          </div>

          <div className="relative flex items-center justify-between text-slate-300 py-0.5 pr-1">
            <div className="flex items-center gap-1.5">
              <Handle
                type="target"
                position={Position.Left}
                id="scene"
                className="!w-3 !h-3 !bg-purple-500 !border-2 !border-slate-900 !-left-4"
              />
              <span className="font-mono text-purple-400 font-semibold text-[11px]">SCN</span>
              <span className="text-[11px]">Direkt</span>
            </div>
            <span className="text-[10px] text-purple-400/80 font-mono">18.001</span>
          </div>

          <div className="relative flex items-center justify-between text-slate-300 py-0.5 pr-1">
            <div className="flex items-center gap-1.5">
              <Handle
                type="target"
                position={Position.Left}
                id="all_off"
                className="!w-3 !h-3 !bg-rose-500 !border-2 !border-slate-900 !-left-4"
              />
              <span className="font-mono text-rose-400 font-semibold text-[11px]">AUS</span>
              <span className="text-[11px]">Zentral</span>
            </div>
            <span
              className="text-[10px] bg-slate-800/90 border border-slate-700/60 px-1.5 py-0.5 rounded text-rose-400 font-mono"
              title="KNX Gruppenadresse: Alles Aus (DPT 1.001)"
            >
              {getGa('all_off') || 'Auto'}
            </span>
          </div>
        </div>

        {/* Right: Outputs */}
        <div className="space-y-1.5 text-right">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            KNX Ausgänge / Wires
          </div>

          <div className="relative flex items-center justify-end gap-1.5 text-slate-300 py-0.5">
            <span className="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-purple-400 font-mono">
              {getGa('scene_ctrl') || 'Auto'}
            </span>
            <span className="font-mono text-purple-400 font-semibold text-[11px]">SCENE</span>
            <Handle
              type="source"
              position={Position.Right}
              id="scene_ctrl"
              className="!w-3 !h-3 !bg-purple-500 !border-2 !border-slate-900 !-right-4"
            />
          </div>

          <div className="relative flex items-center justify-end gap-1.5 text-slate-300 py-0.5">
            <span className="text-[10px] text-amber-400/80 font-mono">K1: Decke</span>
            <span className="font-mono text-amber-400 font-semibold text-[11px]">CH1</span>
            <Handle
              type="source"
              position={Position.Right}
              id="ch1_val"
              className="!w-3 !h-3 !bg-amber-500 !border-2 !border-slate-900 !-right-4"
            />
          </div>

          <div className="relative flex items-center justify-end gap-1.5 text-slate-300 py-0.5">
            <span className="text-[10px] text-pink-400/80 font-mono">K2: Wand</span>
            <span className="font-mono text-pink-400 font-semibold text-[11px]">CH2</span>
            <Handle
              type="source"
              position={Position.Right}
              id="ch2_val"
              className="!w-3 !h-3 !bg-pink-500 !border-2 !border-slate-900 !-right-4"
            />
          </div>

          <div className="relative flex items-center justify-end gap-1.5 text-slate-300 py-0.5">
            <span className="text-[10px] text-cyan-400/80 font-mono">K3: Indirekt</span>
            <span className="font-mono text-cyan-400 font-semibold text-[11px]">CH3</span>
            <Handle
              type="source"
              position={Position.Right}
              id="ch3_val"
              className="!w-3 !h-3 !bg-cyan-500 !border-2 !border-slate-900 !-right-4"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export const SceneBlockNode = memo(SceneBlockNodeComponent)
