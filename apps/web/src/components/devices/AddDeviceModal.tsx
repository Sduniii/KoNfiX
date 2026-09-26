import React, { useState, useMemo, useEffect, useRef } from 'react'
import {
  X,
  Search,
  Cpu,
  Plus,
  Trash2,
  Sliders,
  Layers,
  Check,
  Building,
  Sparkles,
  ChevronRight,
  Upload,
  FileCode,
  AlertCircle,
  Loader2,
  Database,
  RefreshCw,
  DownloadCloud,
} from 'lucide-react'
import {
  KnxDevice,
  Room,
  ChannelType,
  DeviceChannel,
  CatalogProduct,
  CatalogProductSummary,
} from '../../types/knx'
import {
  HARDWARE_CATALOG,
  CatalogDeviceTemplate,
  createDeviceFromTemplate,
  getNextIndividualAddress,
} from '../../data/hardwareCatalog'
import {
  fetchCatalogProducts,
  fetchCatalogProduct,
  importKnxprodFile,
  createDeviceFromProduct,
  downloadDefaultCatalog,
  syncProjectWithCatalog,
} from '../../services/api'

interface AddDeviceModalProps {
  isOpen: boolean
  onClose: () => void
  existingDevices: KnxDevice[]
  rooms: Room[]
  currentRoomId: string | null
  onAddDevice: (device: KnxDevice) => void
}

export const AddDeviceModal: React.FC<AddDeviceModalProps> = ({
  isOpen,
  onClose,
  existingDevices,
  rooms,
  currentRoomId,
  onAddDevice,
}) => {
  const [tab, setTab] = useState<'knxprod' | 'templates' | 'custom'>('knxprod')

  // .knxprod Catalog State
  const [knxprodProducts, setKnxprodProducts] = useState<CatalogProductSummary[]>([])
  const [selectedSummary, setSelectedSummary] = useState<CatalogProductSummary | null>(null)
  const [selectedProduct, setSelectedProduct] = useState<CatalogProduct | null>(null)
  const [isLoadingProductDetail, setIsLoadingProductDetail] = useState<boolean>(false)
  const [isLoadingCatalog, setIsLoadingCatalog] = useState<boolean>(false)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [knxprodSearch, setKnxprodSearch] = useState('')
  const [selectedKnxprodManufacturer, setSelectedKnxprodManufacturer] = useState<string>('all')
  const [previewSubTab, setPreviewSubTab] = useState<'kos' | 'params'>('kos')
  const [isUploading, setIsUploading] = useState(false)
  const [isDownloadingDefault, setIsDownloadingDefault] = useState(false)
  const [isSyncingProject, setIsSyncingProject] = useState(false)
  const [syncStatusMessage, setSyncStatusMessage] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Quick Templates Tab State
  const [templateSearch, setTemplateSearch] = useState('')
  const [selectedManufacturer, setSelectedManufacturer] = useState<string>('all')
  const [selectedTrade, setSelectedTrade] = useState<string>('all')
  const [selectedTemplate, setSelectedTemplate] = useState<CatalogDeviceTemplate | null>(null)

  // Common Device Config Fields
  const [deviceAddress, setDeviceAddress] = useState('')
  const [deviceName, setDeviceName] = useState('')
  const [selectedRoomId, setSelectedRoomId] = useState<string>(currentRoomId || '')

  // Custom Device Tab State
  const [customName, setCustomName] = useState('')
  const [customManufacturer, setCustomManufacturer] = useState('')
  const [customModel, setCustomModel] = useState('')
  const [customAddress, setCustomAddress] = useState('')
  const [customRoomId, setCustomRoomId] = useState<string>(currentRoomId || '')
  const [customChannels, setCustomChannels] = useState<
    Array<{ channel_code: string; name: string; channel_type: ChannelType }>
  >([
    { channel_code: 'Kanal A', name: 'Kanal A Last', channel_type: 'SwitchOutput' },
    { channel_code: 'Kanal B', name: 'Kanal B Last', channel_type: 'SwitchOutput' },
  ])

  // Load catalog products from backend on mount or open
  useEffect(() => {
    if (isOpen) {
      loadKnxprodCatalog()
      const nextAddr = getNextIndividualAddress(existingDevices)
      setDeviceAddress(nextAddr)
      setCustomAddress(nextAddr)
      setSelectedRoomId(currentRoomId || '')
      setCustomRoomId(currentRoomId || '')

      if (HARDWARE_CATALOG.length > 0 && !selectedTemplate) {
        setSelectedTemplate(HARDWARE_CATALOG[0])
      }
    }
  }, [isOpen, existingDevices, currentRoomId])

  const loadKnxprodCatalog = async () => {
    setIsLoadingCatalog(true)
    setCatalogError(null)
    try {
      const products = await fetchCatalogProducts()
      setKnxprodProducts(products)
      if (products.length > 0 && !selectedSummary) {
        handleSelectProduct(products[0])
      }
    } catch (err: any) {
      console.warn('Could not load knxprod catalog products:', err)
      setCatalogError(err.message || 'Katalog konnte nicht geladen werden.')
    } finally {
      setIsLoadingCatalog(false)
    }
  }

  const handleDownloadDefaultDatabase = async () => {
    setIsDownloadingDefault(true)
    setSyncStatusMessage(null)
    try {
      const res = await downloadDefaultCatalog()
      await loadKnxprodCatalog()
      setSyncStatusMessage(res.message || `${res.loaded_count} Produkte geladen.`)
    } catch (err: any) {
      setSyncStatusMessage(`Fehler beim Laden: ${err.message}`)
    } finally {
      setIsDownloadingDefault(false)
    }
  }

  const handleSyncProjectWithCatalog = async () => {
    setIsSyncingProject(true)
    setSyncStatusMessage(null)
    try {
      const res = await syncProjectWithCatalog()
      setSyncStatusMessage(res.message || `${res.enriched_count} Geräte synchronisiert.`)
    } catch (err: any) {
      setSyncStatusMessage(`Fehler beim Synchronisieren: ${err.message}`)
    } finally {
      setIsSyncingProject(false)
    }
  }

  const handleSelectProduct = async (summary: CatalogProductSummary) => {
    setSelectedSummary(summary)
    setDeviceName(summary.name)
    setIsLoadingProductDetail(true)
    try {
      const detail = await fetchCatalogProduct(summary.id)
      setSelectedProduct(detail)
    } catch (err) {
      console.warn('Konnte Produktdetails nicht laden:', err)
    } finally {
      setIsLoadingProductDetail(false)
    }
  }

  const handleSelectTemplate = (tpl: CatalogDeviceTemplate) => {
    setSelectedTemplate(tpl)
    setDeviceName(tpl.name)
  }

  // Handle .knxprod file upload
  const handleFileUpload = async (file: File) => {
    const lowerName = file.name.toLowerCase()
    if (lowerName.endsWith('.vd4') || lowerName.endsWith('.vd_') || lowerName.endsWith('.vd3') || lowerName.endsWith('.vd2') || lowerName.endsWith('.vd1')) {
      alert(`Die Datei "${file.name}" ist ein veraltetes ETS-Format (Stand 2007) mit 32-Bit-Windows-DLLs.\n\nKoNfiX unterstützt moderne, standardisierte XML-basierte .knxprod-Archive.\nBitte verwende die offizielle .knxprod-Datei des Herstellers oder konvertiere die Datei einmalig über die ETS.`)
      return
    }

    if (!file.name.endsWith('.knxprod') && !file.name.endsWith('.zip')) {
      alert('Bitte eine gültige .knxprod Datei auswählen.')
      return
    }

    setIsUploading(true)
    setCatalogError(null)

    try {
      const reader = new FileReader()
      reader.onload = async (e) => {
        try {
          const result = e.target?.result as string
          // Remove Data URL prefix: data:application/...;base64,
          const base64 = result.includes(',') ? result.split(',')[1] : result
          const imported = await importKnxprodFile(undefined, base64)
          await loadKnxprodCatalog()
          if (imported.length > 0) {
            handleSelectProduct(imported[0])
          }
        } catch (err: any) {
          console.error('Import error:', err)
          setCatalogError(err.message || 'Fehler beim Parsen der .knxprod Datei.')
        } finally {
          setIsUploading(false)
        }
      }
      reader.readAsDataURL(file)
    } catch (err: any) {
      setCatalogError(err.message)
      setIsUploading(false)
    }
  }

  // Drag & drop handlers
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0])
    }
  }

  // Filtered .knxprod products
  const filteredKnxprod = useMemo(() => {
    return knxprodProducts.filter((p) => {
      const q = knxprodSearch.toLowerCase().trim()
      const matchesSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.order_number.toLowerCase().includes(q) ||
        p.manufacturer.toLowerCase().includes(q) ||
        p.application_program.toLowerCase().includes(q)

      const matchesManufacturer =
        selectedKnxprodManufacturer === 'all' ||
        p.manufacturer === selectedKnxprodManufacturer

      return matchesSearch && matchesManufacturer
    })
  }, [knxprodProducts, knxprodSearch, selectedKnxprodManufacturer])

  // Manufacturers in .knxprod catalog
  const knxprodManufacturers = useMemo(() => {
    const set = new Set<string>()
    knxprodProducts.forEach((p) => set.add(p.manufacturer))
    return Array.from(set)
  }, [knxprodProducts])

  // Filtered Template Devices
  const filteredTemplates = useMemo(() => {
    return HARDWARE_CATALOG.filter((item) => {
      const matchesSearch =
        templateSearch.trim() === '' ||
        item.name.toLowerCase().includes(templateSearch.toLowerCase()) ||
        item.model.toLowerCase().includes(templateSearch.toLowerCase()) ||
        item.manufacturer.toLowerCase().includes(templateSearch.toLowerCase()) ||
        item.description.toLowerCase().includes(templateSearch.toLowerCase())

      const matchesManufacturer =
        selectedManufacturer === 'all' || item.manufacturer === selectedManufacturer

      const matchesTrade = selectedTrade === 'all' || item.trade === selectedTrade

      return matchesSearch && matchesManufacturer && matchesTrade
    })
  }, [templateSearch, selectedManufacturer, selectedTrade])

  // Submit from .knxprod Catalog
  const handleSubmitKnxprod = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedSummary) return

    try {
      const dev = await createDeviceFromProduct(
        selectedSummary.id,
        deviceAddress.trim() || '1.1.20',
        deviceName.trim() || selectedSummary.name,
        selectedRoomId || undefined
      )
      onAddDevice(dev)
      onClose()
    } catch (err: any) {
      console.error('Failed to create device from product:', err)
      // Fallback local creation if selectedProduct was loaded
      if (selectedProduct) {
        const devId = crypto.randomUUID()
        const channels: DeviceChannel[] = selectedProduct.default_channels.map((ch) => ({
          id: crypto.randomUUID(),
          device_id: devId,
          channel_code: ch.channel_code,
          name: ch.name,
          channel_type: ch.channel_type,
          room_id: selectedRoomId || null,
          position: null,
        }))

        const device: KnxDevice = {
          id: devId,
          individual_address: deviceAddress.trim() || '1.1.20',
          manufacturer: selectedProduct.manufacturer,
          model: selectedProduct.order_number,
          name: deviceName.trim() || selectedProduct.name,
          channels,
          position: null,
          order_number: selectedProduct.order_number,
          application_program: selectedProduct.application_program,
          mask_version: selectedProduct.mask_version,
          bus_current_ma: selectedProduct.bus_current_ma,
          communication_objects: selectedProduct.communication_objects,
          parameters: selectedProduct.parameters,
        }
        onAddDevice(device)
        onClose()
      }
    }
  }

  // Submit from Quick Templates
  const handleSubmitTemplate = (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedTemplate) return

    const device = createDeviceFromTemplate(
      selectedTemplate,
      deviceAddress.trim() || '1.1.20',
      deviceName.trim() || selectedTemplate.name,
      selectedRoomId || null
    )

    onAddDevice(device)
    onClose()
  }

  // Add Row to Custom Channels
  const handleAddCustomChannel = () => {
    const nextLetter = String.fromCharCode(65 + customChannels.length)
    setCustomChannels((prev) => [
      ...prev,
      {
        channel_code: `Kanal ${nextLetter}`,
        name: `Ausgang ${nextLetter}`,
        channel_type: 'SwitchOutput',
      },
    ])
  }

  const handleRemoveCustomChannel = (idx: number) => {
    if (customChannels.length <= 1) return
    setCustomChannels((prev) => prev.filter((_, i) => i !== idx))
  }

  // Submit Custom Device
  const handleSubmitCustom = (e: React.FormEvent) => {
    e.preventDefault()
    if (!customName.trim()) return

    const deviceId = crypto.randomUUID()
    const channels: DeviceChannel[] = customChannels.map((c) => ({
      id: crypto.randomUUID(),
      device_id: deviceId,
      channel_code: c.channel_code,
      name: c.name,
      channel_type: c.channel_type,
      room_id: customRoomId || null,
      position: null,
    }))

    const device: KnxDevice = {
      id: deviceId,
      individual_address: customAddress.trim() || '1.1.20',
      manufacturer: customManufacturer.trim() || 'Generisch',
      model: customModel.trim() || 'Standard-Gerät',
      name: customName.trim(),
      channels,
      position: null,
      communication_objects: [],
      parameters: [],
    }

    onAddDevice(device)
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="flex flex-col w-full max-w-5xl h-[88vh] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-400">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                KNX-Gerät hinzufügen
                <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-sky-950 text-sky-300 border border-sky-800/60 font-mono">
                  .knxprod Katalog
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Wähle ein Gerät aus dem originalen Herstellerkatalog mit KOs & Parametern oder erstelle eigene Aktoren.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selector */}
        <div className="flex border-b border-slate-800 bg-slate-950/60 px-6 text-xs font-semibold shrink-0">
          <button
            onClick={() => setTab('knxprod')}
            className={`py-3 px-4 border-b-2 transition-colors flex items-center gap-2 ${
              tab === 'knxprod'
                ? 'border-sky-500 text-sky-400 font-bold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sparkles className="w-4 h-4 text-sky-400" />
            <span>ETS Herstellerkatalog (.knxprod)</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-sky-950 text-sky-300 border border-sky-800">
              {knxprodProducts.length}
            </span>
          </button>

          <button
            onClick={() => setTab('templates')}
            className={`py-3 px-4 border-b-2 transition-colors flex items-center gap-2 ${
              tab === 'templates'
                ? 'border-sky-500 text-sky-400 font-bold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Building className="w-4 h-4" />
            <span>Schnell-Vorlagen</span>
          </button>

          <button
            onClick={() => setTab('custom')}
            className={`py-3 px-4 border-b-2 transition-colors flex items-center gap-2 ${
              tab === 'custom'
                ? 'border-sky-500 text-sky-400 font-bold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sliders className="w-4 h-4" />
            <span>Manuell / Eigener Aktor</span>
          </button>
        </div>

        {/* TAB 1: KNXPROD CATALOG */}
        {tab === 'knxprod' && (
          <div className="flex-1 flex overflow-hidden">
            {/* Left: Device List, Search & Upload */}
            <div className="w-7/12 border-r border-slate-800 flex flex-col p-4 space-y-3 overflow-hidden">
              {/* Search & Drag-Drop Upload Area */}
              <div className="space-y-2">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      placeholder="Produkt, Bestellnummer oder Applikation suchen..."
                      value={knxprodSearch}
                      onChange={(e) => setKnxprodSearch(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700/80 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-200 placeholder:text-slate-500 outline-none focus:border-sky-500"
                    />
                  </div>

                  <input
                    type="file"
                    ref={fileInputRef}
                    accept=".knxprod,.zip"
                    onChange={(e) => {
                      if (e.target.files && e.target.files.length > 0) {
                        handleFileUpload(e.target.files[0])
                      }
                    }}
                    className="hidden"
                  />

                  <button
                    type="button"
                    onClick={handleDownloadDefaultDatabase}
                    disabled={isDownloadingDefault || isLoadingCatalog}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors shrink-0 shadow-sm disabled:opacity-50"
                    title="Standard-Produktdatenbank (MDT & ETS3) laden"
                  >
                    {isDownloadingDefault ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Database className="w-3.5 h-3.5" />
                    )}
                    <span>Datenbank laden</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSyncProjectWithCatalog}
                    disabled={isSyncingProject}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors shrink-0 shadow-sm disabled:opacity-50"
                    title="Bestehende Projektgeräte mit Datenbank abgleichen (Werte & GAs bleiben erhalten)"
                  >
                    {isSyncingProject ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                    <span>Projekt abgleichen</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold transition-colors shrink-0 shadow-sm disabled:opacity-50"
                    title=".knxprod Datei hochladen"
                  >
                    {isUploading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Upload className="w-3.5 h-3.5" />
                    )}
                    <span>.knxprod Import</span>
                  </button>
                </div>

                {syncStatusMessage && (
                  <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-emerald-950/40 border border-emerald-800/60 text-emerald-300 text-xs animate-in fade-in duration-150">
                    <span className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />
                      {syncStatusMessage}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSyncStatusMessage(null)}
                      className="text-emerald-400 hover:text-emerald-200 text-xs font-bold px-1"
                    >
                      ×
                    </button>
                  </div>
                )}

                {/* Dropzone Notice */}
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleDrop}
                  className="p-2.5 rounded-xl border border-dashed border-slate-800 bg-slate-950/40 text-center hover:border-sky-500/50 transition-colors cursor-pointer"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <p className="text-[11px] text-slate-400">
                    <span className="font-semibold text-sky-400">Eigene .knxprod Datei hier ablegen</span> oder klicken zum Durchsuchen
                  </p>
                </div>
              </div>

              {/* Manufacturer Pills */}
              {knxprodManufacturers.length > 0 && (
                <div className="flex flex-wrap gap-1.5 text-[11px]">
                  <button
                    onClick={() => setSelectedKnxprodManufacturer('all')}
                    className={`px-2.5 py-1 rounded-lg transition-colors ${
                      selectedKnxprodManufacturer === 'all'
                        ? 'bg-sky-500 text-slate-950 font-bold'
                        : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Alle ({knxprodProducts.length})
                  </button>
                  {knxprodManufacturers.map((m) => (
                    <button
                      key={m}
                      onClick={() => setSelectedKnxprodManufacturer(m)}
                      className={`px-2.5 py-1 rounded-lg transition-colors ${
                        selectedKnxprodManufacturer === m
                          ? 'bg-sky-500 text-slate-950 font-bold'
                          : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {m.replace(' Technologies', '')}
                    </button>
                  ))}
                </div>
              )}

              {/* Product Card List */}
              <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                {isLoadingCatalog ? (
                  <div className="flex flex-col items-center justify-center h-48 text-slate-400 gap-2">
                    <Loader2 className="w-6 h-6 animate-spin text-sky-400" />
                    <span className="text-xs">Katalog wird geladen...</span>
                  </div>
                ) : filteredKnxprod.length === 0 ? (
                  <div className="text-center py-12 text-slate-500 text-xs italic">
                    Keine KNX-Geräte gefunden. Importiere eine .knxprod Datei per Drag & Drop!
                  </div>
                ) : (
                  filteredKnxprod.map((prod) => {
                    const isSelected = selectedSummary?.id === prod.id

                    return (
                      <div
                        key={prod.id}
                        onClick={() => handleSelectProduct(prod)}
                        className={`p-3 rounded-xl border transition-all cursor-pointer flex flex-col gap-2 ${
                          isSelected
                            ? 'bg-sky-950/40 border-sky-500 shadow-md'
                            : 'bg-slate-950/40 border-slate-800/80 hover:border-slate-700 hover:bg-slate-950'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-bold text-slate-200">
                                {prod.name}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[11px] font-mono text-sky-400 font-semibold">
                                {prod.order_number}
                              </span>
                              <span className="text-[10px] text-slate-400">
                                • {prod.manufacturer}
                              </span>
                            </div>
                          </div>

                          {/* Badges for KOs and Parameters from lightweight summary */}
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-sky-300 border border-slate-700">
                              {prod.ko_count} KOs
                            </span>
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-emerald-300 border border-slate-700">
                              {prod.param_count} Param
                            </span>
                          </div>
                        </div>

                        {prod.application_program && (
                          <div className="text-[10px] text-slate-500 truncate font-mono">
                            App: {prod.application_program}
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </div>

            {/* Right: Selected Product Configuration & KO/Param Preview */}
            <div className="w-5/12 flex flex-col p-5 bg-slate-950/40 overflow-y-auto space-y-4">
              {selectedSummary ? (
                <form onSubmit={handleSubmitKnxprod} className="flex-1 flex flex-col justify-between space-y-4">
                  <div className="space-y-4">
                    {/* Selected Header */}
                    <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                          Ausgewähltes Gerät
                        </span>
                        <span className="font-mono text-xs font-bold text-sky-400">
                          {selectedSummary.order_number}
                        </span>
                      </div>
                      <div className="text-sm font-bold text-slate-100">
                        {selectedSummary.name}
                      </div>
                      <div className="flex flex-wrap gap-2 text-[10px] text-slate-400 pt-1 border-t border-slate-800">
                        <span>Mask: {selectedSummary.mask_version}</span>
                        <span>•</span>
                        <span>Strom: {selectedSummary.bus_current_ma} mA</span>
                        <span>•</span>
                        <span>Kanäle: {selectedSummary.channel_count}</span>
                      </div>
                    </div>

                    {/* Form Fields: Address, Name, Room */}
                    <div className="space-y-3 bg-slate-900/60 p-3.5 rounded-xl border border-slate-800">
                      <div>
                        <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                          Physikalische KNX-Adresse:
                        </label>
                        <input
                          type="text"
                          required
                          placeholder="z. B. 1.1.20"
                          value={deviceAddress}
                          onChange={(e) => setDeviceAddress(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs font-mono text-sky-400 font-bold outline-none focus:border-sky-500"
                        />
                      </div>

                      <div>
                        <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                          Gerätename im Projekt:
                        </label>
                        <input
                          type="text"
                          required
                          value={deviceName}
                          onChange={(e) => setDeviceName(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 outline-none focus:border-sky-500"
                        />
                      </div>

                      <div>
                        <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                          Raumzuweisung (Optional):
                        </label>
                        <select
                          value={selectedRoomId}
                          onChange={(e) => setSelectedRoomId(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 outline-none focus:border-sky-500"
                        >
                          <option value="">Kein Raum (Verteiler / Zentral)</option>
                          {rooms.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Preview Tabs: KOs & Parameters */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between border-b border-slate-800 pb-1">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setPreviewSubTab('kos')}
                            className={`text-[11px] font-semibold pb-1 border-b-2 transition-colors ${
                              previewSubTab === 'kos'
                                ? 'border-sky-500 text-sky-400'
                                : 'border-transparent text-slate-500 hover:text-slate-300'
                            }`}
                          >
                            KOs Vorschau ({selectedProduct?.communication_objects.length ?? selectedSummary.ko_count})
                          </button>
                          <button
                            type="button"
                            onClick={() => setPreviewSubTab('params')}
                            className={`text-[11px] font-semibold pb-1 border-b-2 transition-colors ${
                              previewSubTab === 'params'
                                ? 'border-emerald-500 text-emerald-400'
                                : 'border-transparent text-slate-500 hover:text-slate-300'
                            }`}
                          >
                            Parameter Vorschau ({selectedProduct?.parameters.length ?? selectedSummary.param_count})
                          </button>
                        </div>
                        {isLoadingProductDetail && (
                          <div className="flex items-center gap-1 text-[10px] text-sky-400">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            <span>Laden...</span>
                          </div>
                        )}
                      </div>

                      {isLoadingProductDetail && !selectedProduct ? (
                        <div className="flex flex-col items-center justify-center p-8 text-slate-400 gap-2">
                          <Loader2 className="w-5 h-5 animate-spin text-sky-400" />
                          <span className="text-xs">Parameter & KOs werden geladen...</span>
                        </div>
                      ) : selectedProduct ? (

                      <div className="max-h-48 overflow-y-auto space-y-1 pr-1 text-xs">
                        {previewSubTab === 'kos' ? (
                          selectedProduct.communication_objects.slice(0, 15).map((ko) => (
                            <div
                              key={ko.number}
                              className="p-1.5 rounded bg-slate-900 border border-slate-800/80 flex items-center justify-between text-[11px]"
                            >
                              <div className="flex items-center gap-1.5 truncate">
                                <span className="font-mono text-slate-400 font-bold w-6">
                                  #{ko.number}
                                </span>
                                <span className="font-medium text-slate-200 truncate">
                                  {ko.object_text || ko.name}
                                </span>
                              </div>
                              <span className="font-mono text-[10px] text-sky-400 bg-sky-950 px-1 py-0.5 rounded border border-sky-800/40 shrink-0">
                                {ko.dpt}
                              </span>
                            </div>
                          ))
                        ) : (
                          selectedProduct.parameters.slice(0, 15).map((p) => (
                            <div
                              key={p.id}
                              className="p-1.5 rounded bg-slate-900 border border-slate-800/80 flex items-center justify-between text-[11px]"
                            >
                              <span className="text-slate-300 truncate max-w-[180px]">
                                {p.text || p.name}
                              </span>
                              <span className="font-mono text-[10px] text-emerald-400 shrink-0">
                                {p.value} {p.suffix || ''}
                              </span>
                            </div>
                          ))
                        )}
                        {(previewSubTab === 'kos'
                          ? selectedProduct.communication_objects.length
                          : selectedProduct.parameters.length) > 15 && (
                          <div className="text-[10px] text-center text-slate-500 pt-1 italic">
                            ... und{' '}
                            {(previewSubTab === 'kos'
                              ? selectedProduct.communication_objects.length
                              : selectedProduct.parameters.length) - 15}{' '}
                            weitere
                          </div>
                        )}
                      </div>
                    ) : null}
                    </div>
                  </div>

                  {/* Submit Button */}
                  <button
                    type="submit"
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs transition-colors shadow-lg shadow-sky-950"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Gerät zum Projekt hinzufügen</span>
                  </button>
                </form>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-500 text-xs italic">
                  Wähle links ein Gerät aus, um Details und KOs zu sehen.
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: QUICK TEMPLATES */}
        {tab === 'templates' && (
          <div className="flex-1 flex overflow-hidden">
            {/* Left: Device List & Search */}
            <div className="w-7/12 border-r border-slate-800 flex flex-col p-4 space-y-3 overflow-hidden">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Gerät, Modellnummer oder Funktion suchen..."
                  value={templateSearch}
                  onChange={(e) => setTemplateSearch(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700/80 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-200 placeholder:text-slate-500 outline-none focus:border-sky-500"
                />
              </div>

              {/* Template Device Cards Scroll */}
              <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                {filteredTemplates.map((tpl) => {
                  const isSelected = selectedTemplate?.id === tpl.id

                  return (
                    <div
                      key={tpl.id}
                      onClick={() => handleSelectTemplate(tpl)}
                      className={`p-3 rounded-xl border transition-all cursor-pointer flex flex-col gap-2 ${
                        isSelected
                          ? 'bg-sky-950/40 border-sky-500 shadow-md'
                          : 'bg-slate-950/40 border-slate-800/80 hover:border-slate-700 hover:bg-slate-950'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <span className="text-xs font-bold text-slate-200">{tpl.name}</span>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[11px] font-mono text-sky-400 font-semibold">
                              {tpl.model}
                            </span>
                            <span className="text-[10px] text-slate-400">• {tpl.manufacturer}</span>
                          </div>
                        </div>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">
                          {tpl.channels.length} Kanäle
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Right: Selected Template Configuration */}
            <div className="w-5/12 flex flex-col p-5 bg-slate-950/40 overflow-y-auto space-y-4">
              {selectedTemplate ? (
                <form onSubmit={handleSubmitTemplate} className="flex-1 flex flex-col justify-between space-y-4">
                  <div className="space-y-4">
                    <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900 space-y-2">
                      <div className="text-sm font-bold text-slate-100">{selectedTemplate.name}</div>
                      <p className="text-xs text-slate-400">{selectedTemplate.description}</p>
                    </div>

                    <div className="space-y-3 bg-slate-900/60 p-3.5 rounded-xl border border-slate-800">
                      <div>
                        <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                          Physikalische KNX-Adresse:
                        </label>
                        <input
                          type="text"
                          required
                          value={deviceAddress}
                          onChange={(e) => setDeviceAddress(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs font-mono text-sky-400 font-bold outline-none focus:border-sky-500"
                        />
                      </div>

                      <div>
                        <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                          Gerätename im Projekt:
                        </label>
                        <input
                          type="text"
                          required
                          value={deviceName}
                          onChange={(e) => setDeviceName(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 outline-none focus:border-sky-500"
                        />
                      </div>

                      <div>
                        <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                          Raumzuweisung:
                        </label>
                        <select
                          value={selectedRoomId}
                          onChange={(e) => setSelectedRoomId(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 outline-none focus:border-sky-500"
                        >
                          <option value="">Kein Raum (Zentral)</option>
                          {rooms.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs transition-colors shadow-lg shadow-sky-950"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Vorlage zum Projekt hinzufügen</span>
                  </button>
                </form>
              ) : null}
            </div>
          </div>
        )}

        {/* TAB 3: CUSTOM DEVICE */}
        {tab === 'custom' && (
          <form onSubmit={handleSubmitCustom} className="flex-1 flex flex-col p-6 space-y-4 overflow-y-auto">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                  Gerätename:
                </label>
                <input
                  type="text"
                  required
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder="z. B. Dali Gateway EG"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                  Physikalische Adresse:
                </label>
                <input
                  type="text"
                  required
                  value={customAddress}
                  onChange={(e) => setCustomAddress(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-sky-400 font-bold outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                  Hersteller:
                </label>
                <input
                  type="text"
                  value={customManufacturer}
                  onChange={(e) => setCustomManufacturer(e.target.value)}
                  placeholder="z. B. MDT Technologies, Gira..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                  Modell:
                </label>
                <input
                  type="text"
                  value={customModel}
                  onChange={(e) => setCustomModel(e.target.value)}
                  placeholder="z. B. SCN-DALI64.03"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none focus:border-sky-500"
                />
              </div>
            </div>

            {/* Channels Table */}
            <div className="space-y-2 pt-2 border-t border-slate-800">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200">
                  Kanäle & Klemmen ({customChannels.length})
                </span>
                <button
                  type="button"
                  onClick={handleAddCustomChannel}
                  className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Kanal hinzufügen</span>
                </button>
              </div>

              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {customChannels.map((c, i) => (
                  <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-slate-950 border border-slate-800">
                    <input
                      type="text"
                      value={c.channel_code}
                      onChange={(e) => {
                        const val = e.target.value
                        setCustomChannels((prev) =>
                          prev.map((item, idx) => (idx === i ? { ...item, channel_code: val } : item))
                        )
                      }}
                      className="w-24 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-sky-400 font-bold"
                    />
                    <input
                      type="text"
                      value={c.name}
                      onChange={(e) => {
                        const val = e.target.value
                        setCustomChannels((prev) =>
                          prev.map((item, idx) => (idx === i ? { ...item, name: val } : item))
                        )
                      }}
                      className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
                    />
                    <select
                      value={c.channel_type}
                      onChange={(e) => {
                        const val = e.target.value as ChannelType
                        setCustomChannels((prev) =>
                          prev.map((item, idx) => (idx === i ? { ...item, channel_type: val } : item))
                        )
                      }}
                      className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
                    >
                      <option value="SwitchOutput">Schaltausgang</option>
                      <option value="DimmerOutput">Dimm-Ausgang</option>
                      <option value="BlindOutput">Jalousie-Ausgang</option>
                      <option value="HeatingOutput">Heizungsausgang</option>
                      <option value="PushButtonInput">Taster-Eingang</option>
                      <option value="PresenceSensorInput">Präsenz-Eingang</option>
                      <option value="TempSensorInput">Temperatur-Eingang</option>
                    </select>
                    {customChannels.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveCustomChannel(i)}
                        className="p-1 text-slate-500 hover:text-red-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-4 flex justify-end">
              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold shadow-lg shadow-sky-950"
              >
                Gerät manuell anlegen
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
