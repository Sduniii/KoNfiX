import React, { useState } from 'react'
import {
  Download,
  Play,
  Pencil,
  Network,
  FileSpreadsheet,
  FileCode,
  FileJson,
  Upload,
  Sparkles,
  Radio,
  FolderArchive,
  LayoutGrid,
  Activity,
  ChevronDown,
  Save,
  FolderOpen,
  FolderCog,
  Check,
  Globe,
} from 'lucide-react'
import { Project, GatewayConnectionStatus } from '../../types/knx'
import { downloadEtsCsv, downloadEtsXml, downloadKnxproj } from '../../services/api'
import { useTranslation } from '../../i18n/I18nContext'

interface HeaderProps {
  project: Project | null
  appVersion?: string | null
  isSimulating: boolean
  isWsConnected: boolean
  gatewayStatus?: GatewayConnectionStatus | null
  activeWorkspace?: 'canvas' | 'topology' | 'diagnostics'
  onWorkspaceChange?: (ws: 'canvas' | 'topology' | 'diagnostics') => void
  onToggleSimulate: () => void
  onAutoRoute: () => void
  isRouting: boolean
  onOpenGaManager?: () => void
  onOpenGatewayModal?: () => void
  onOpenImportModal?: () => void
  onOpenExportKnxprojModal?: () => void
  onOpenProjectModal?: () => void
  onOpenStorageSettingsModal?: () => void
  onSaveProject?: () => void
  lastSavedTime?: string | null
  isSaving?: boolean
  onExportJson?: () => void
  onImportJson?: (e: React.ChangeEvent<HTMLInputElement>) => void
}

export const Header: React.FC<HeaderProps> = ({
  project,
  appVersion,
  isSimulating,
  isWsConnected,
  gatewayStatus,
  activeWorkspace = 'canvas',
  onWorkspaceChange,
  onToggleSimulate,
  onAutoRoute,
  isRouting,
  onOpenGaManager,
  onOpenGatewayModal,
  onOpenImportModal,
  onOpenExportKnxprojModal,
  onOpenProjectModal,
  onOpenStorageSettingsModal,
  onSaveProject,
  lastSavedTime,
  isSaving = false,
  onExportJson,
  onImportJson,
}) => {
  const { locale, setLocale, languages, t } = useTranslation()
  const [showProjectMenu, setShowProjectMenu] = useState(false)
  const [showLangMenu, setShowLangMenu] = useState(false)

  const gaCount = project?.group_addresses?.length ?? 0
  const deviceCount = project?.devices?.length ?? 0

  return (
    <header className="h-14 border-b border-slate-800 bg-slate-900/95 backdrop-blur px-4 flex items-center justify-between select-none z-30 shrink-0 relative">
      {/* ========================================================================= */}
      {/* ZONE 1: LINKS (Branding & Zentrales Projekt & ETS Menü)                   */}
      {/* ========================================================================= */}
      <div className="flex items-center gap-3 shrink-0">
        {/* Logo & KoNfiX Branding */}
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-emerald-500 to-sky-400 flex items-center justify-center font-black text-slate-950 text-sm shadow-md shadow-emerald-500/20 shrink-0">
            K
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5 leading-none">
              <span className="font-bold text-xs text-slate-100 tracking-wide">KoNfiX</span>
              <span
                className="text-[9px] font-mono tracking-wider bg-sky-500/10 text-sky-400 border border-sky-500/20 px-1.5 py-0.2 rounded font-semibold"
                title={`KoNfiX Backend Version ${appVersion || t('common.loading')}`}
              >
                {appVersion ? `v${appVersion}` : 'v...'}
              </span>
            </div>
            <div
              className="text-[11px] text-slate-400 font-medium truncate max-w-[180px] sm:max-w-[240px] flex items-center gap-1 mt-0.5"
              title={`${project?.name || t('sidebar.project')} (${gaCount} GAs, ${deviceCount} ${t('common.devices')})`}
            >
              <span className="text-slate-300 font-semibold">{project?.name || t('sidebar.project')}</span>
              <span className="text-slate-600">•</span>
              <span className="text-slate-400 text-[10px]">{gaCount} GAs</span>
              <span className="text-slate-600">•</span>
              <span className="text-slate-400 text-[10px]">{deviceCount} {t('common.devices')}</span>
            </div>
          </div>
        </div>

        {/* Quick-Save Button */}
        {onSaveProject && (
          <button
            onClick={onSaveProject}
            disabled={isSaving}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-emerald-300 border border-slate-700/80 hover:border-emerald-500/50 transition-all disabled:opacity-50"
            title={`${t('header.saveProject')} (Strg+S)${lastSavedTime ? `\n${t('header.saved')}: ${lastSavedTime}` : ''}`}
          >
            {isSaving ? (
              <span className="w-3.5 h-3.5 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
            ) : lastSavedTime ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Save className="w-3.5 h-3.5 text-emerald-400" />
            )}
            <span className="hidden xl:inline text-[11px] font-medium text-slate-300">
              {isSaving ? t('header.saving') : lastSavedTime ? lastSavedTime : t('common.save')}
            </span>
          </button>
        )}

        {/* Zentrales "Projekt & ETS"-Dropdown */}
        <div className="relative ml-0.5">
          <button
            onClick={() => setShowProjectMenu(!showProjectMenu)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
              showProjectMenu
                ? 'bg-slate-800 text-slate-100 border-emerald-500/50 shadow-sm'
                : 'bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-slate-100 border-slate-700/80'
            }`}
            title={t('header.projectAndEts')}
          >
            <FolderArchive className="w-3.5 h-3.5 text-emerald-400" />
            <span>{t('header.projectAndEts')}</span>
            <ChevronDown
              className={`w-3 h-3 text-slate-400 transition-transform duration-200 ${
                showProjectMenu ? 'rotate-180 text-emerald-400' : ''
              }`}
            />
          </button>

          {showProjectMenu && (
            <>
              {/* Backdrop zum Schließen bei Klick außerhalb */}
              <div
                className="fixed inset-0 z-40"
                onClick={() => setShowProjectMenu(false)}
              />

              {/* Dropdown-Menü */}
              <div className="absolute left-0 mt-2 w-64 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl p-1.5 z-50 text-xs text-slate-200 animate-in fade-in-50 zoom-in-95 duration-150">
                {/* Gruppe 0: KoNfiX Dateisystem & Projektverwaltung */}
                <div className="px-2.5 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                  <span>{t('header.projectManagement')}</span>
                  <span className="text-[9px] text-emerald-400 font-mono">~/.konfix</span>
                </div>

                {onSaveProject && (
                  <button
                    onClick={() => {
                      setShowProjectMenu(false)
                      onSaveProject()
                    }}
                    disabled={isSaving}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-emerald-950/40 hover:bg-emerald-900/50 border border-emerald-500/30 text-left transition-colors mb-1 group"
                  >
                    <Save className="w-4 h-4 text-emerald-400 shrink-0 group-hover:scale-110 transition-transform" />
                    <div className="flex-1">
                      <div className="font-semibold text-emerald-300 flex items-center justify-between">
                        <span>{t('header.saveProject')}</span>
                        <span className="text-[9px] bg-slate-800 text-slate-400 border border-slate-700 px-1 py-0.2 rounded font-mono">
                          Strg+S
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {lastSavedTime ? `${t('header.saved')}: ${lastSavedTime}` : '~/.konfix/projects'}
                      </div>
                    </div>
                  </button>
                )}

                {onOpenProjectModal && (
                  <button
                    onClick={() => {
                      setShowProjectMenu(false)
                      onOpenProjectModal()
                    }}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-slate-800 text-left transition-colors mb-1"
                  >
                    <FolderOpen className="w-4 h-4 text-sky-400 shrink-0" />
                    <div>
                      <div className="font-semibold text-slate-100">{t('header.openProject')}</div>
                      <div className="text-[10px] text-slate-400">Projekte wechseln oder anlegen</div>
                    </div>
                  </button>
                )}

                {onOpenStorageSettingsModal && (
                  <button
                    onClick={() => {
                      setShowProjectMenu(false)
                      onOpenStorageSettingsModal()
                    }}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-slate-800 text-left transition-colors mb-2"
                  >
                    <FolderCog className="w-4 h-4 text-amber-400 shrink-0" />
                    <div>
                      <div className="font-semibold text-slate-100">{t('header.storageSettings')}</div>
                      <div className="text-[10px] text-slate-400">Standardverzeichnis konfigurieren</div>
                    </div>
                  </button>
                )}

                <div className="border-t border-slate-800 my-1"></div>

                {/* Gruppe 1: ETS Datenaustausch */}
                <div className="px-2.5 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                  <span>{t('header.etsDataExchange')}</span>
                  <span className="text-[9px] text-emerald-400 font-mono">Schema 23</span>
                </div>

                <button
                  onClick={() => {
                    setShowProjectMenu(false)
                    if (onOpenExportKnxprojModal) {
                      onOpenExportKnxprojModal()
                    } else {
                      downloadKnxproj()
                    }
                  }}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-emerald-950/40 hover:bg-emerald-900/50 border border-emerald-500/30 text-left transition-colors mb-1 group"
                >
                  <Download className="w-4 h-4 text-emerald-400 shrink-0 group-hover:scale-110 transition-transform" />
                  <div>
                    <div className="font-semibold text-emerald-300 flex items-center gap-1.5">
                      <span>{t('header.exportKnxproj')}</span>
                      <span className="text-[9px] bg-emerald-500/20 text-emerald-400 px-1 py-0.2 rounded font-bold">
                        .knxproj
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-400">100% kompatibel mit ETS 5 & 6</div>
                  </div>
                </button>

                {onOpenImportModal && (
                  <button
                    onClick={() => {
                      setShowProjectMenu(false)
                      onOpenImportModal()
                    }}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-slate-800 text-left transition-colors"
                  >
                    <Upload className="w-4 h-4 text-sky-400 shrink-0" />
                    <div>
                      <div className="font-semibold text-slate-100">{t('header.importEtsProject')}</div>
                      <div className="text-[10px] text-slate-400">.knxproj oder GA-CSV einlesen</div>
                    </div>
                  </button>
                )}

                <button
                  onClick={() => {
                    setShowProjectMenu(false)
                    downloadEtsCsv()
                  }}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-slate-800 text-left transition-colors"
                >
                  <FileSpreadsheet className="w-4 h-4 text-emerald-400 shrink-0" />
                  <div>
                    <div className="font-semibold text-slate-100">{t('header.groupAddressesCsv')}</div>
                    <div className="text-[10px] text-slate-400">ETS 3-Ebenen GA-Tabelle</div>
                  </div>
                </button>

                <button
                  onClick={() => {
                    setShowProjectMenu(false)
                    downloadEtsXml()
                  }}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-slate-800 text-left transition-colors"
                >
                  <FileCode className="w-4 h-4 text-sky-400 shrink-0" />
                  <div>
                    <div className="font-semibold text-slate-100">{t('header.etsXmlData')}</div>
                    <div className="text-[10px] text-slate-400">0.xml Standard-Format</div>
                  </div>
                </button>

                {/* Gruppe 2: Gruppenadress-Organisation */}
                {onOpenGaManager && (
                  <div className="border-t border-slate-800 my-1 pt-1">
                    <div className="px-2.5 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      {t('header.gaStructure')}
                    </div>
                    <button
                      onClick={() => {
                        setShowProjectMenu(false)
                        onOpenGaManager()
                      }}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-slate-800 text-left transition-colors"
                    >
                      <Network className="w-4 h-4 text-amber-400 shrink-0" />
                      <div>
                        <div className="font-semibold text-slate-100 flex items-center gap-1.5">
                          <span>{t('header.gaSchemeAndPlan')}</span>
                          <span className="text-[9px] bg-slate-800 text-slate-300 px-1 py-0.2 rounded border border-slate-700 font-mono">
                            {project?.ga_scheme === 'TradeRoomFunction'
                              ? 'Gewerk/Raum'
                              : project?.ga_scheme === 'TradeFunctionDevice'
                              ? 'Kompakt'
                              : 'Etage/Gewerk'}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Routing-Hierarchie verwalten
                        </div>
                      </div>
                    </button>
                  </div>
                )}

                {/* Gruppe 3: Lokale Sicherung (JSON) */}
                {(onExportJson || onImportJson) && (
                  <div className="border-t border-slate-800 my-1 pt-1">
                    <div className="px-2.5 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      {t('header.projectBackup')}
                    </div>
                    {onExportJson && (
                      <button
                        onClick={() => {
                          setShowProjectMenu(false)
                          onExportJson()
                        }}
                        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-slate-800 text-left transition-colors"
                      >
                        <FileJson className="w-4 h-4 text-amber-400 shrink-0" />
                        <div>
                          <div className="font-semibold text-slate-100">{t('header.saveAsJson')}</div>
                          <div className="text-[10px] text-slate-400">
                            Vollständiges Backup herunterladen
                          </div>
                        </div>
                      </button>
                    )}
                    {onImportJson && (
                      <label className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-slate-800 text-left transition-colors cursor-pointer">
                        <Upload className="w-4 h-4 text-slate-400 shrink-0" />
                        <div>
                          <div className="font-semibold text-slate-100">
                            {t('header.restoreFromJson')}
                          </div>
                          <div className="text-[10px] text-slate-400">Backup-Datei öffnen</div>
                        </div>
                        <input
                          type="file"
                          accept=".json"
                          onChange={(e) => {
                            setShowProjectMenu(false)
                            onImportJson(e)
                          }}
                          className="hidden"
                        />
                      </label>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* ZONE 2: MITTE (Zentrierter Arbeitsbereichs-Umschalter)                     */}
      {/* ========================================================================= */}
      {onWorkspaceChange && (
        <div className="hidden md:flex items-center absolute left-1/2 -translate-x-1/2">
          <div className="flex items-center bg-slate-950/80 p-1 rounded-xl border border-slate-800 shadow-inner">
            <button
              onClick={() => onWorkspaceChange('canvas')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeWorkspace === 'canvas'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/40'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
              title={t('workspaces.canvasDesc')}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>{t('workspaces.canvas')}</span>
            </button>
            <button
              onClick={() => onWorkspaceChange('topology')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeWorkspace === 'topology'
                  ? 'bg-amber-600 text-white shadow-md shadow-amber-900/40'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
              title={t('workspaces.topologyDesc')}
            >
              <Network className="w-3.5 h-3.5 text-amber-300" />
              <span>{t('workspaces.topology')}</span>
            </button>
            <button
              onClick={() => onWorkspaceChange('diagnostics')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeWorkspace === 'diagnostics'
                  ? 'bg-sky-600 text-white shadow-md shadow-sky-900/40'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
              title={t('workspaces.diagnosticsDesc')}
            >
              <Activity className="w-3.5 h-3.5 text-sky-300" />
              <span>{t('workspaces.diagnostics')}</span>
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ZONE 3: RECHTS (Kontextbezogene Aktionen & Kombinierter Systemstatus)      */}
      {/* ========================================================================= */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Canvas-spezifische Aktionen: Auto-GA & Simulation */}
        {activeWorkspace === 'canvas' && (
          <div className="flex items-center gap-2 border-r border-slate-800 pr-2">
            {/* Auto-Route Quick Action */}
            <button
              onClick={onAutoRoute}
              disabled={isRouting}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-800/80 hover:bg-slate-800 text-slate-200 border border-slate-700/80 hover:border-amber-500/40 transition-all disabled:opacity-50"
              title={t('header.autoGaDesc')}
            >
              <Sparkles
                className={`w-3.5 h-3.5 text-amber-400 ${isRouting ? 'animate-spin' : ''}`}
              />
              <span className="hidden sm:inline">{t('header.autoGa')}</span>
            </button>

            {/* Mode Switch: Simulation vs Entwurf */}
            <button
              onClick={onToggleSimulate}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                isSimulating
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm shadow-emerald-950'
                  : 'bg-slate-800/80 hover:bg-slate-800 text-slate-300 border border-slate-700/80'
              }`}
              title={
                isSimulating
                  ? `${t('header.simulation')} aktiv`
                  : `${t('header.draft')} aktiv`
              }
            >
              {isSimulating ? (
                <>
                  <Play className="w-3 h-3 fill-emerald-400 text-emerald-400 animate-pulse" />
                  <span>{t('header.simulation')}</span>
                </>
              ) : (
                <>
                  <Pencil className="w-3 h-3 text-sky-400" />
                  <span>{t('header.draft')}</span>
                </>
              )}
            </button>
          </div>
        )}

        {/* Kombinierte System-Status-Pill (Gateway & Daemon) */}
        <button
          onClick={onOpenGatewayModal}
          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-mono transition-all border ${
            gatewayStatus?.connected
              ? 'bg-emerald-950/40 hover:bg-emerald-900/40 border-emerald-500/40 text-emerald-300 shadow-sm'
              : 'bg-slate-800/80 hover:bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
          }`}
          title={`KNX-Gateway: ${
            gatewayStatus?.connected ? gatewayStatus.gateway_ip : t('header.disconnected')
          }\nRust Core Daemon: ${isWsConnected ? 'Online (Port 8080)' : 'Offline'}\nKlicken für Verbindungsmanager`}
        >
          <div className="flex items-center gap-1.5">
            <div
              className={`w-2 h-2 rounded-full shrink-0 ${
                gatewayStatus?.connected && isWsConnected
                  ? 'bg-emerald-400 animate-pulse'
                  : isWsConnected
                  ? 'bg-amber-400'
                  : 'bg-red-400'
              }`}
            />
            <Radio className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          </div>
          <span className="font-semibold text-[11px]">
            {gatewayStatus?.connected ? gatewayStatus.gateway_ip : `KNX: ${t('header.disconnected')}`}
          </span>
          {isWsConnected && (
            <span className="hidden xl:inline text-[9px] text-emerald-400 bg-emerald-500/10 px-1 py-0.2 rounded font-semibold">
              Core
            </span>
          )}
        </button>

        {/* Mehrsprachigkeit / Language Switcher Dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowLangMenu(!showLangMenu)}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-slate-100 border border-slate-700/80 transition-all"
            title={t('header.language')}
          >
            <span className="text-sm leading-none">{locale === 'de' ? '🇩🇪' : '🇬🇧'}</span>
            <span className="text-[11px] font-mono uppercase font-bold text-slate-300">{locale}</span>
            <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform duration-200 ${showLangMenu ? 'rotate-180 text-emerald-400' : ''}`} />
          </button>

          {showLangMenu && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setShowLangMenu(false)}
              />
              <div className="absolute right-0 mt-2 w-36 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl p-1 z-50 text-xs text-slate-200 animate-in fade-in-50 zoom-in-95 duration-150">
                <div className="px-2.5 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Globe className="w-3 h-3 text-emerald-400" />
                  <span>{t('header.language')}</span>
                </div>
                {languages.map((lang) => (
                  <button
                    key={lang.code}
                    onClick={() => {
                      setLocale(lang.code)
                      setShowLangMenu(false)
                    }}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-colors ${
                      locale === lang.code
                        ? 'bg-emerald-950/60 text-emerald-300 font-semibold border border-emerald-500/30'
                        : 'hover:bg-slate-800 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{lang.flag}</span>
                      <span>{lang.label}</span>
                    </div>
                    {locale === lang.code && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
