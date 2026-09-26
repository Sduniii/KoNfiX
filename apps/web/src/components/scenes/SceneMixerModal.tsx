import React, { useState, useEffect } from 'react'
import {
  X,
  Sliders,
  Sparkles,
  Sun,
  Moon,
  Tv,
  Coffee,
  Check,
  Plus,
  Trash2,
  Play,
  RotateCcw,
  Lightbulb,
  Clock,
  Save,
  VolumeX,
} from 'lucide-react'
import { FunctionBlock, SceneDefinition, LightCircuit } from '../../types/knx'

interface SceneMixerModalProps {
  isOpen: boolean
  onClose: () => void
  block: FunctionBlock
  onSaveBlock: (updatedBlock: FunctionBlock) => void
  onAction?: (pin: string, value: any) => void
  roomName?: string
}

const DEFAULT_CIRCUITS: LightCircuit[] = [
  { id: 'c1', name: 'Decke Hauptlicht', type: 'dimmer', color: '#f59e0b' },
  { id: 'c2', name: 'Wandleuchten', type: 'dimmer', color: '#ec4899' },
  { id: 'c3', name: 'Indirekt / LED-Stripe', type: 'dimmer', color: '#8b5cf6' },
  { id: 'c4', name: 'Esstisch / Pendel', type: 'dimmer', color: '#06b6d4' },
]

const DEFAULT_SCENES: SceneDefinition[] = [
  {
    no: 1,
    name: 'Normal / Hell',
    icon: '☀️',
    fade_time: 1.5,
    values: { c1: 90, c2: 70, c3: 80, c4: 85 },
  },
  {
    no: 2,
    name: 'Kochen / Essen',
    icon: '🍳',
    fade_time: 1.5,
    values: { c1: 100, c2: 80, c3: 40, c4: 100 },
  },
  {
    no: 3,
    name: 'TV / Relax',
    icon: '🍿',
    fade_time: 2.0,
    values: { c1: 0, c2: 25, c3: 45, c4: 0 },
  },
  {
    no: 4,
    name: 'Nacht / Orientierung',
    icon: '🌙',
    fade_time: 2.5,
    values: { c1: 0, c2: 10, c3: 15, c4: 0 },
  },
  {
    no: 5,
    name: 'Alles Aus',
    icon: '🌑',
    fade_time: 1.0,
    values: { c1: 0, c2: 0, c3: 0, c4: 0 },
  },
]

export const SceneMixerModal: React.FC<SceneMixerModalProps> = ({
  isOpen,
  onClose,
  block,
  onSaveBlock,
  onAction,
  roomName,
}) => {
  const circuits: LightCircuit[] = block.parameters?.circuits || DEFAULT_CIRCUITS
  const [scenes, setScenes] = useState<SceneDefinition[]>(
    block.parameters?.scenes || DEFAULT_SCENES
  )
  const [selectedSceneNo, setSelectedSceneNo] = useState<number>(
    block.state?.active_scene || 1
  )
  const [faderValues, setFaderValues] = useState<Record<string, number>>({})
  const [fadeTime, setFadeTime] = useState<number>(1.5)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  // Synchronize when block or selected scene changes
  useEffect(() => {
    const scList = block.parameters?.scenes || DEFAULT_SCENES
    setScenes(scList)
    const activeNo = block.state?.active_scene || 1
    setSelectedSceneNo(activeNo)

    const curScene = scList.find((s: SceneDefinition) => s.no === activeNo) || scList[0]
    if (curScene) {
      setFaderValues({ ...curScene.values })
      setFadeTime(curScene.fade_time || 1.5)
    }
  }, [block])

  if (!isOpen) return null

  const handleSelectSceneTab = (no: number) => {
    setSelectedSceneNo(no)
    const targetScene = scenes.find((s) => s.no === no)
    if (targetScene) {
      setFaderValues({ ...targetScene.values })
      setFadeTime(targetScene.fade_time || 1.5)
    }
  }

  const handleFaderChange = (circuitId: string, val: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(val)))
    setFaderValues((prev) => ({ ...prev, [circuitId]: clamped }))
  }

  const handleSaveCurrentScene = (activate = false) => {
    const updatedScenes = scenes.map((s) => {
      if (s.no === selectedSceneNo) {
        return {
          ...s,
          fade_time: fadeTime,
          values: { ...faderValues },
        }
      }
      return s
    })

    setScenes(updatedScenes)

    const updatedBlock: FunctionBlock = {
      ...block,
      parameters: {
        ...block.parameters,
        circuits,
        scenes: updatedScenes,
      },
      state: {
        ...block.state,
        active_scene: selectedSceneNo,
        scene_name:
          updatedScenes.find((s) => s.no === selectedSceneNo)?.name || `Szene ${selectedSceneNo}`,
        fader_values: { ...faderValues },
      },
    }

    onSaveBlock(updatedBlock)

    if (activate) {
      onAction?.('scene', selectedSceneNo)
    }

    setToastMessage(activate ? 'Gespeichert & auf Bus aktiviert!' : 'Stimmung gespeichert!')
    setTimeout(() => setToastMessage(null), 2500)
  }

  const handleAddScene = () => {
    const nextNo = scenes.length > 0 ? Math.max(...scenes.map((s) => s.no)) + 1 : 1
    const newScene: SceneDefinition = {
      no: nextNo,
      name: `Stimmung ${nextNo}`,
      icon: '✨',
      fade_time: 1.5,
      values: { ...faderValues },
    }
    const updated = [...scenes, newScene]
    setScenes(updated)
    setSelectedSceneNo(nextNo)
  }

  const handleDeleteScene = (no: number, e: React.MouseEvent) => {
    e.stopPropagation()
    if (scenes.length <= 1) return
    const updated = scenes.filter((s) => s.no !== no)
    setScenes(updated)
    if (selectedSceneNo === no) {
      const fallback = updated[0]?.no || 1
      setSelectedSceneNo(fallback)
      const targetScene = updated.find((s) => s.no === fallback)
      if (targetScene) setFaderValues({ ...targetScene.values })
    }
  }

  const handleMasterAllOff = () => {
    const offValues: Record<string, number> = {}
    circuits.forEach((c) => {
      offValues[c.id] = 0
    })
    setFaderValues(offValues)
    onAction?.('all_off', true)
  }

  const handleMasterAllFull = () => {
    const fullValues: Record<string, number> = {}
    circuits.forEach((c) => {
      fullValues[c.id] = 100
    })
    setFaderValues(fullValues)
  }

  const currentScene = scenes.find((s) => s.no === selectedSceneNo)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-4xl bg-slate-900 border-2 border-purple-500/40 rounded-2xl shadow-2xl shadow-purple-950/60 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-gradient-to-r from-slate-900 via-purple-950/40 to-slate-900">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-purple-500/20 text-purple-400 border border-purple-500/30">
              <Sliders className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-white tracking-wide">
                  Lichtsteuerungs-Mischpult
                </h2>
                <span className="text-xs font-mono bg-purple-900/60 border border-purple-700/50 text-purple-300 px-2 py-0.5 rounded-full">
                  DPT 18.001
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Studio Stimmungs-Mixer für {roomName || 'den Raum'} • {block.name}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {toastMessage && (
              <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-400 bg-emerald-950/70 border border-emerald-700/60 px-3 py-1.5 rounded-lg animate-in fade-in duration-150">
                <Check className="w-3.5 h-3.5" />
                {toastMessage}
              </div>
            )}
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scene Selector Ribbon */}
        <div className="px-6 py-3 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between gap-4 overflow-x-auto">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400 whitespace-nowrap">
              Stimmung:
            </span>
            <div className="flex items-center gap-1.5">
              {scenes.map((sc) => {
                const isSelected = selectedSceneNo === sc.no
                return (
                  <button
                    key={sc.no}
                    onClick={() => handleSelectSceneTab(sc.no)}
                    className={`group relative flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                      isSelected
                        ? 'bg-purple-600 border border-purple-400 text-white shadow-lg shadow-purple-900/50 font-semibold'
                        : 'bg-slate-800/80 hover:bg-slate-800 border border-slate-700/70 text-slate-300'
                    }`}
                  >
                    <span className="text-sm">{sc.icon || '✨'}</span>
                    <span>{sc.name}</span>
                    {scenes.length > 2 && (
                      <span
                        onClick={(e) => handleDeleteScene(sc.no, e)}
                        title="Stimmung entfernen"
                        className="opacity-0 group-hover:opacity-100 hover:text-red-300 transition-opacity ml-1"
                      >
                        <Trash2 className="w-3 h-3" />
                      </span>
                    )}
                  </button>
                )
              })}
              <button
                onClick={handleAddScene}
                title="Neue Stimmung anlegen"
                className="flex items-center gap-1 px-2.5 py-2 rounded-xl text-xs bg-slate-800/50 hover:bg-purple-900/40 hover:text-purple-300 border border-dashed border-slate-700 hover:border-purple-600 text-slate-400 transition-all"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Neu</span>
              </button>
            </div>
          </div>

          {/* Quick Scene Trigger */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => onAction?.('scene', selectedSceneNo)}
              title="Aktuelle Stimmung live auf dem Bus abrufen (DPT 18.001)"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-950 transition-all"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Bus Testen</span>
            </button>
          </div>
        </div>

        {/* Mixer Desk Body */}
        <div className="flex-1 p-6 overflow-y-auto bg-slate-950/40 flex flex-col gap-6">
          {/* Active Scene Bar & Fade Time Setting */}
          <div className="flex flex-wrap items-center justify-between gap-4 p-3.5 bg-slate-900/90 rounded-xl border border-slate-800 shadow-inner">
            <div className="flex items-center gap-3">
              <span className="text-2xl p-2 rounded-lg bg-slate-800 border border-slate-700">
                {currentScene?.icon || '✨'}
              </span>
              <div>
                <div className="text-sm font-bold text-white flex items-center gap-2">
                  <span>{currentScene?.name || `Szene ${selectedSceneNo}`}</span>
                  <span className="text-[10px] text-purple-400 font-mono">
                    KNX Szene #{selectedSceneNo}
                  </span>
                </div>
                <div className="text-xs text-slate-400">
                  Passe die Schieberegler unten an und speichere die Stimmung ab.
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700">
                <Clock className="w-4 h-4 text-purple-400" />
                <span className="text-xs text-slate-300">Überblendzeit:</span>
                <span className="text-xs font-mono font-bold text-purple-300 w-10 text-right">
                  {fadeTime.toFixed(1)}s
                </span>
                <input
                  type="range"
                  min="0"
                  max="10"
                  step="0.5"
                  value={fadeTime}
                  onChange={(e) => setFadeTime(parseFloat(e.target.value))}
                  className="w-20 accent-purple-500 cursor-pointer"
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleMasterAllFull}
                  title="Alle Kanäle auf 100%"
                  className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
                >
                  Alle 100%
                </button>
                <button
                  onClick={handleMasterAllOff}
                  title="Alle Kanäle ausschalten (0%)"
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-rose-950/60 hover:bg-rose-900 border border-rose-800/60 text-rose-300 transition-colors"
                >
                  <VolumeX className="w-3.5 h-3.5" />
                  <span>Alle Aus</span>
                </button>
              </div>
            </div>
          </div>

          {/* Vertical Fader Strip Array (The DJ / Soundcraft Mixer Deck) */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 flex-1">
            {circuits.map((circ, idx) => {
              const val = faderValues[circ.id] ?? 0
              const isOn = val > 0

              return (
                <div
                  key={circ.id}
                  className="flex flex-col items-center bg-slate-900/90 rounded-2xl border border-slate-800 p-4 shadow-xl relative overflow-hidden group hover:border-purple-600/50 transition-all"
                >
                  {/* Channel Header */}
                  <div className="w-full text-center pb-3 border-b border-slate-800/80">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-mono font-bold text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">
                        K{idx + 1}
                      </span>
                      <div
                        className="w-2.5 h-2.5 rounded-full"
                        style={{
                          backgroundColor: circ.color || '#a855f7',
                          boxShadow: isOn ? `0 0 8px ${circ.color || '#a855f7'}` : 'none',
                        }}
                      />
                    </div>
                    <div className="text-xs font-bold text-slate-200 truncate" title={circ.name}>
                      {circ.name}
                    </div>
                  </div>

                  {/* Level Bulb Preview */}
                  <div className="my-3 flex items-center justify-center">
                    <div
                      className="w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-300 border"
                      style={{
                        backgroundColor: isOn
                          ? `${circ.color || '#f59e0b'}25`
                          : 'rgba(30, 41, 59, 0.4)',
                        borderColor: isOn
                          ? `${circ.color || '#f59e0b'}80`
                          : 'rgba(51, 65, 85, 0.5)',
                        boxShadow: isOn
                          ? `0 0 16px ${circ.color || '#f59e0b'}40`
                          : 'none',
                      }}
                    >
                      <Lightbulb
                        className="w-6 h-6 transition-all duration-300"
                        style={{
                          color: isOn ? circ.color || '#f59e0b' : '#64748b',
                          filter: isOn ? 'drop-shadow(0 0 4px currentColor)' : 'none',
                        }}
                      />
                    </div>
                  </div>

                  {/* Vertical Fader Track */}
                  <div className="relative flex-1 flex items-center justify-center my-2 min-h-[160px] w-full">
                    {/* Visual VU Meter Ladder (background behind fader) */}
                    <div className="absolute inset-y-0 w-3 bg-slate-950 rounded-full border border-slate-800 flex flex-col justify-end p-0.5 overflow-hidden">
                      <div
                        className="w-full rounded-full transition-all duration-150"
                        style={{
                          height: `${val}%`,
                          backgroundColor: circ.color || '#a855f7',
                        }}
                      />
                    </div>

                    {/* Standard Range Slider rotated vertically */}
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={val}
                      onChange={(e) => handleFaderChange(circ.id, parseFloat(e.target.value))}
                      className="h-36 w-6 accent-purple-400 cursor-pointer -rotate-90 origin-center z-10 opacity-75 hover:opacity-100 transition-opacity"
                    />
                  </div>

                  {/* Value Percentage readout */}
                  <div className="w-full text-center mt-2">
                    <div className="text-lg font-mono font-extrabold text-white">
                      {val}{' '}
                      <span className="text-xs text-slate-400 font-normal">%</span>
                    </div>
                  </div>

                  {/* Quick Action buttons */}
                  <div className="w-full grid grid-cols-2 gap-1.5 mt-3 pt-3 border-t border-slate-800/80">
                    <button
                      onClick={() => handleFaderChange(circ.id, 0)}
                      className={`py-1 text-[11px] font-semibold rounded ${
                        val === 0
                          ? 'bg-rose-950 text-rose-300 border border-rose-800'
                          : 'bg-slate-800 hover:bg-slate-700 text-slate-400'
                      }`}
                    >
                      0%
                    </button>
                    <button
                      onClick={() => handleFaderChange(circ.id, 100)}
                      className={`py-1 text-[11px] font-semibold rounded ${
                        val === 100
                          ? 'bg-purple-900 text-purple-200 border border-purple-600'
                          : 'bg-slate-800 hover:bg-slate-700 text-slate-400'
                      }`}
                    >
                      100%
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-900/95 flex items-center justify-between">
          <div className="text-xs text-slate-400 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>Verbindung aktiv: Änderungen werden in Baustein & ETS-Modell gespeichert</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 border border-slate-700 transition-colors"
            >
              Schließen
            </button>
            <button
              onClick={() => handleSaveCurrentScene(false)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-purple-300 border border-purple-600/50 hover:border-purple-500 transition-all shadow-md"
            >
              <Save className="w-4 h-4" />
              <span>Stimmung speichern</span>
            </button>
            <button
              onClick={() => handleSaveCurrentScene(true)}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-lg shadow-purple-950 transition-all"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>Speichern & Auslösen</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
