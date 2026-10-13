import React from 'react'
import { LayoutGrid, Network, Activity, Home } from 'lucide-react'
import { useTranslation } from '../../i18n/I18nContext'

interface MobileBottomNavProps {
  activeWorkspace: 'canvas' | 'topology' | 'diagnostics' | 'floorplan'
  onWorkspaceChange: (ws: 'canvas' | 'topology' | 'diagnostics' | 'floorplan') => void
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  activeWorkspace,
  onWorkspaceChange,
}) => {
  const { t } = useTranslation()

  const tabs: {
    id: 'canvas' | 'topology' | 'diagnostics' | 'floorplan'
    label: string
    icon: React.ReactNode
    color: string
    activeBg: string
    textColor: string
  }[] = [
    {
      id: 'canvas',
      label: t('workspaces.canvas'),
      icon: <LayoutGrid className="w-5 h-5 shrink-0" />,
      color: 'text-emerald-400',
      activeBg: 'bg-emerald-500/15 border-emerald-500/30',
      textColor: 'text-emerald-300 font-semibold',
    },
    {
      id: 'topology',
      label: t('workspaces.topology'),
      icon: <Network className="w-5 h-5 shrink-0" />,
      color: 'text-amber-400',
      activeBg: 'bg-amber-500/15 border-amber-500/30',
      textColor: 'text-amber-300 font-semibold',
    },
    {
      id: 'diagnostics',
      label: t('workspaces.diagnostics'),
      icon: <Activity className="w-5 h-5 shrink-0" />,
      color: 'text-sky-400',
      activeBg: 'bg-sky-500/15 border-sky-500/30',
      textColor: 'text-sky-300 font-semibold',
    },
    {
      id: 'floorplan',
      label: 'Hausplan',
      icon: <Home className="w-5 h-5 shrink-0" />,
      color: 'text-purple-400',
      activeBg: 'bg-purple-500/15 border-purple-500/30',
      textColor: 'text-purple-300 font-semibold',
    },
  ]

  return (
    <nav
      aria-label="Mobile Navigation"
      className="md:hidden h-14 border-t border-slate-800 bg-slate-900/95 backdrop-blur px-2 flex items-center justify-around select-none z-30 shrink-0 pb-[env(safe-area-inset-bottom)]"
    >
      {tabs.map((tab) => {
        const isActive = activeWorkspace === tab.id
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onWorkspaceChange(tab.id)}
            className={`flex-1 flex flex-col items-center justify-center py-1 px-1 rounded-xl transition-all duration-150 min-h-[44px] ${
              isActive
                ? `${tab.activeBg} border ${tab.textColor} shadow-sm`
                : 'text-slate-400 hover:text-slate-200 active:scale-95'
            }`}
          >
            <div className={isActive ? tab.color : 'text-slate-400'}>
              {tab.icon}
            </div>
            <span
              className={`text-[10px] mt-0.5 leading-tight truncate max-w-full ${
                isActive ? tab.textColor : 'text-slate-400'
              }`}
            >
              {tab.label}
            </span>
          </button>
        )
      })}
    </nav>
  )
}

export default MobileBottomNav
