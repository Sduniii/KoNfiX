import { ChannelType, KnxDevice, DeviceChannel } from '../types/knx'

export interface CatalogChannelTemplate {
  channel_code: string
  default_name: string
  channel_type: ChannelType
}

export interface CatalogDeviceTemplate {
  id: string
  manufacturer: string
  model: string
  name: string
  description: string
  trade: 'lighting' | 'shading' | 'climate' | 'universal'
  channels: CatalogChannelTemplate[]
}

export const HARDWARE_CATALOG: CatalogDeviceTemplate[] = [
  // ==================== MDT TECHNOLOGIES ====================
  {
    id: 'mdt-akd-0424r-02',
    manufacturer: 'MDT Technologies',
    model: 'AKD-0424R.02',
    name: 'MDT 4-fach LED-Dimmaktor 24V',
    description: '4 Kanäle für CV LED-Streifen (12-24V DC, max. 4A je Kanal), RGBW oder 4x Weiß',
    trade: 'lighting',
    channels: [
      { channel_code: 'Kanal A', default_name: 'Dimm-Kanal A', channel_type: 'DimmerOutput' },
      { channel_code: 'Kanal B', default_name: 'Dimm-Kanal B', channel_type: 'DimmerOutput' },
      { channel_code: 'Kanal C', default_name: 'Dimm-Kanal C', channel_type: 'DimmerOutput' },
      { channel_code: 'Kanal D', default_name: 'Dimm-Kanal D', channel_type: 'DimmerOutput' },
    ],
  },
  {
    id: 'mdt-akd-0401-02',
    manufacturer: 'MDT Technologies',
    model: 'AKD-0401.02',
    name: 'MDT 4-fach Universaldimmaktor 230V',
    description: '4 Kanäle Phasenan-/abschnitt für dimmbare 230V LED-Leuchtmittel (250W je Kanal)',
    trade: 'lighting',
    channels: [
      { channel_code: 'Kanal A', default_name: '230V Dimm-Kanal A', channel_type: 'DimmerOutput' },
      { channel_code: 'Kanal B', default_name: '230V Dimm-Kanal B', channel_type: 'DimmerOutput' },
      { channel_code: 'Kanal C', default_name: '230V Dimm-Kanal C', channel_type: 'DimmerOutput' },
      { channel_code: 'Kanal D', default_name: '230V Dimm-Kanal D', channel_type: 'DimmerOutput' },
    ],
  },
  {
    id: 'mdt-jal-0410m-02',
    manufacturer: 'MDT Technologies',
    model: 'JAL-0410M.02',
    name: 'MDT 4-fach Jalousieaktor 230V',
    description: '4 Kanäle für Jalousien, Raffstores oder Rollläden mit automatischer Fahrzeitmessung',
    trade: 'shading',
    channels: [
      { channel_code: 'Kanal A', default_name: 'Jalousie Kanal A', channel_type: 'BlindOutput' },
      { channel_code: 'Kanal B', default_name: 'Jalousie Kanal B', channel_type: 'BlindOutput' },
      { channel_code: 'Kanal C', default_name: 'Jalousie Kanal C', channel_type: 'BlindOutput' },
      { channel_code: 'Kanal D', default_name: 'Jalousie Kanal D', channel_type: 'BlindOutput' },
    ],
  },
  {
    id: 'mdt-jal-0810m-02',
    manufacturer: 'MDT Technologies',
    model: 'JAL-0810M.02',
    name: 'MDT 8-fach Jalousieaktor 230V',
    description: '8 Kanäle für Jalousien, Rollläden oder Markisen (10A Relais)',
    trade: 'shading',
    channels: [
      { channel_code: 'Kanal A', default_name: 'Jalousie Kanal A', channel_type: 'BlindOutput' },
      { channel_code: 'Kanal B', default_name: 'Jalousie Kanal B', channel_type: 'BlindOutput' },
      { channel_code: 'Kanal C', default_name: 'Jalousie Kanal C', channel_type: 'BlindOutput' },
      { channel_code: 'Kanal D', default_name: 'Jalousie Kanal D', channel_type: 'BlindOutput' },
      { channel_code: 'Kanal E', default_name: 'Jalousie Kanal E', channel_type: 'BlindOutput' },
      { channel_code: 'Kanal F', default_name: 'Jalousie Kanal F', channel_type: 'BlindOutput' },
      { channel_code: 'Kanal G', default_name: 'Jalousie Kanal G', channel_type: 'BlindOutput' },
      { channel_code: 'Kanal H', default_name: 'Jalousie Kanal H', channel_type: 'BlindOutput' },
    ],
  },
  {
    id: 'mdt-aks-0816-03',
    manufacturer: 'MDT Technologies',
    model: 'AKS-0816.03',
    name: 'MDT 8-fach Schaltaktor 16A',
    description: '8 unabhängige Relais-Ausgänge 16A (140µF C-Last) für Beleuchtung oder Steckdosen',
    trade: 'lighting',
    channels: [
      { channel_code: 'Kanal A', default_name: 'Schaltausgang A', channel_type: 'SwitchOutput' },
      { channel_code: 'Kanal B', default_name: 'Schaltausgang B', channel_type: 'SwitchOutput' },
      { channel_code: 'Kanal C', default_name: 'Schaltausgang C', channel_type: 'SwitchOutput' },
      { channel_code: 'Kanal D', default_name: 'Schaltausgang D', channel_type: 'SwitchOutput' },
      { channel_code: 'Kanal E', default_name: 'Schaltausgang E', channel_type: 'SwitchOutput' },
      { channel_code: 'Kanal F', default_name: 'Schaltausgang F', channel_type: 'SwitchOutput' },
      { channel_code: 'Kanal G', default_name: 'Schaltausgang G', channel_type: 'SwitchOutput' },
      { channel_code: 'Kanal H', default_name: 'Schaltausgang H', channel_type: 'SwitchOutput' },
    ],
  },
  {
    id: 'mdt-be-gt20w-01',
    manufacturer: 'MDT Technologies',
    model: 'BE-GT20W.01',
    name: 'MDT Glastaster II Smart',
    description: '6 Sensorflächen mit aktivem Farbdisplay, Temperaturmessung und Szenenfunktion',
    trade: 'universal',
    channels: [
      { channel_code: 'Taste 1', default_name: 'Taste 1 (oben links)', channel_type: 'PushButtonInput' },
      { channel_code: 'Taste 2', default_name: 'Taste 2 (oben rechts)', channel_type: 'PushButtonInput' },
      { channel_code: 'Taste 3', default_name: 'Taste 3 (mitte links)', channel_type: 'PushButtonInput' },
      { channel_code: 'Taste 4', default_name: 'Taste 4 (mitte rechts)', channel_type: 'PushButtonInput' },
      { channel_code: 'Taste 5', default_name: 'Taste 5 (unten links)', channel_type: 'PushButtonInput' },
      { channel_code: 'Taste 6', default_name: 'Taste 6 (unten rechts)', channel_type: 'PushButtonInput' },
      { channel_code: 'Temp', default_name: 'Integrierter Raumtemperaturfühler', channel_type: 'TempSensorInput' },
    ],
  },
  {
    id: 'mdt-scn-p360d4-03',
    manufacturer: 'MDT Technologies',
    model: 'SCN-P360D4.03',
    name: 'MDT Präsenzmelder 360°',
    description: 'Decken-Präsenzmelder mit 4 pyroelektrischen Sensoren und integriertem Helligkeitssensor',
    trade: 'lighting',
    channels: [
      { channel_code: 'Kanal 1', default_name: 'Präsenzerkennung Licht', channel_type: 'PresenceSensorInput' },
      { channel_code: 'Kanal 2', default_name: 'Präsenzerkennung HKL/Klima', channel_type: 'PresenceSensorInput' },
    ],
  },
  {
    id: 'mdt-akh-0800-03',
    manufacturer: 'MDT Technologies',
    model: 'AKH-0800.03',
    name: 'MDT 8-fach Heizungsaktor',
    description: '8 elektronische Ausgänge für thermische Stellantriebe 24V/230V mit PWM-Regelung',
    trade: 'climate',
    channels: [
      { channel_code: 'Ventil 1', default_name: 'Heizkreis 1 Ventil', channel_type: 'HeatingOutput' },
      { channel_code: 'Ventil 2', default_name: 'Heizkreis 2 Ventil', channel_type: 'HeatingOutput' },
      { channel_code: 'Ventil 3', default_name: 'Heizkreis 3 Ventil', channel_type: 'HeatingOutput' },
      { channel_code: 'Ventil 4', default_name: 'Heizkreis 4 Ventil', channel_type: 'HeatingOutput' },
      { channel_code: 'Ventil 5', default_name: 'Heizkreis 5 Ventil', channel_type: 'HeatingOutput' },
      { channel_code: 'Ventil 6', default_name: 'Heizkreis 6 Ventil', channel_type: 'HeatingOutput' },
      { channel_code: 'Ventil 7', default_name: 'Heizkreis 7 Ventil', channel_type: 'HeatingOutput' },
      { channel_code: 'Ventil 8', default_name: 'Heizkreis 8 Ventil', channel_type: 'HeatingOutput' },
    ],
  },

  // ==================== GIRA ====================
  {
    id: 'gira-500400',
    manufacturer: 'Gira',
    model: '500400',
    name: 'Gira Tastsensor 4 Komfort (4-fach)',
    description: 'Echtmaterial-Wippen mit mehrfarbigen Status-LEDs und integriertem Temperaturfühler',
    trade: 'universal',
    channels: [
      { channel_code: 'Taste 1', default_name: 'Wippe 1 links', channel_type: 'PushButtonInput' },
      { channel_code: 'Taste 2', default_name: 'Wippe 1 rechts', channel_type: 'PushButtonInput' },
      { channel_code: 'Taste 3', default_name: 'Wippe 2 links', channel_type: 'PushButtonInput' },
      { channel_code: 'Taste 4', default_name: 'Wippe 2 rechts', channel_type: 'PushButtonInput' },
      { channel_code: 'Taste 5', default_name: 'Wippe 3 links', channel_type: 'PushButtonInput' },
      { channel_code: 'Taste 6', default_name: 'Wippe 3 rechts', channel_type: 'PushButtonInput' },
      { channel_code: 'Taste 7', default_name: 'Wippe 4 links', channel_type: 'PushButtonInput' },
      { channel_code: 'Taste 8', default_name: 'Wippe 4 rechts', channel_type: 'PushButtonInput' },
    ],
  },
  {
    id: 'gira-230800',
    manufacturer: 'Gira',
    model: '230800',
    name: 'Gira Standard Schaltaktor 8-fach',
    description: '8-fach Standard-Schaltaktor 16A REG mit Handschaltung und Statusanzeige',
    trade: 'lighting',
    channels: [
      { channel_code: 'Kanal 1', default_name: 'Schaltausgang 1', channel_type: 'SwitchOutput' },
      { channel_code: 'Kanal 2', default_name: 'Schaltausgang 2', channel_type: 'SwitchOutput' },
      { channel_code: 'Kanal 3', default_name: 'Schaltausgang 3', channel_type: 'SwitchOutput' },
      { channel_code: 'Kanal 4', default_name: 'Schaltausgang 4', channel_type: 'SwitchOutput' },
      { channel_code: 'Kanal 5', default_name: 'Schaltausgang 5', channel_type: 'SwitchOutput' },
      { channel_code: 'Kanal 6', default_name: 'Schaltausgang 6', channel_type: 'SwitchOutput' },
      { channel_code: 'Kanal 7', default_name: 'Schaltausgang 7', channel_type: 'SwitchOutput' },
      { channel_code: 'Kanal 8', default_name: 'Schaltausgang 8', channel_type: 'SwitchOutput' },
    ],
  },
  {
    id: 'gira-217600',
    manufacturer: 'Gira',
    model: '217600',
    name: 'Gira Jalousieaktor 4-fach REG',
    description: '4 unabhängige Kanäle zur Ansteuerung von elektrisch betriebenen Jalousien oder Markisen',
    trade: 'shading',
    channels: [
      { channel_code: 'Kanal 1', default_name: 'Jalousie Ausgang 1', channel_type: 'BlindOutput' },
      { channel_code: 'Kanal 2', default_name: 'Jalousie Ausgang 2', channel_type: 'BlindOutput' },
      { channel_code: 'Kanal 3', default_name: 'Jalousie Ausgang 3', channel_type: 'BlindOutput' },
      { channel_code: 'Kanal 4', default_name: 'Jalousie Ausgang 4', channel_type: 'BlindOutput' },
    ],
  },

  // ==================== THEBEN ====================
  {
    id: 'theben-theronda-s360',
    manufacturer: 'Theben',
    model: 'theRonda S360-100',
    name: 'Theben theRonda S360-100 KNX',
    description: 'Passiv-Infrarot-Präsenzmelder für Deckenmontage mit rundem Erfassungsbereich',
    trade: 'lighting',
    channels: [
      { channel_code: 'Kanal 1', default_name: 'Präsenz Lichtkanal A', channel_type: 'PresenceSensorInput' },
      { channel_code: 'Kanal 2', default_name: 'Präsenz HKL', channel_type: 'PresenceSensorInput' },
    ],
  },
  {
    id: 'theben-dm-4-2-t',
    manufacturer: 'Theben',
    model: 'DM 4-2 T KNX',
    name: 'Theben Universaldimmaktor 4-fach',
    description: '4-fach Universaldimmaktor für R-, L- und C-Lasten mit automatischer Lasterkennung',
    trade: 'lighting',
    channels: [
      { channel_code: 'Kanal 1', default_name: 'Dimm-Ausgang 1', channel_type: 'DimmerOutput' },
      { channel_code: 'Kanal 2', default_name: 'Dimm-Ausgang 2', channel_type: 'DimmerOutput' },
      { channel_code: 'Kanal 3', default_name: 'Dimm-Ausgang 3', channel_type: 'DimmerOutput' },
      { channel_code: 'Kanal 4', default_name: 'Dimm-Ausgang 4', channel_type: 'DimmerOutput' },
    ],
  },
  {
    id: 'theben-jmg-4-t',
    manufacturer: 'Theben',
    model: 'JMG 4 T KNX',
    name: 'Theben Jalousieaktor 4-fach REG',
    description: '4 Antriebe für Behänge mit Positionsrückmeldung und integriertem Sonnenschutz',
    trade: 'shading',
    channels: [
      { channel_code: 'Kanal 1', default_name: 'Jalousieantrieb 1', channel_type: 'BlindOutput' },
      { channel_code: 'Kanal 2', default_name: 'Jalousieantrieb 2', channel_type: 'BlindOutput' },
      { channel_code: 'Kanal 3', default_name: 'Jalousieantrieb 3', channel_type: 'BlindOutput' },
      { channel_code: 'Kanal 4', default_name: 'Jalousieantrieb 4', channel_type: 'BlindOutput' },
    ],
  },

  // ==================== ABB ====================
  {
    id: 'abb-ud-s-4-210',
    manufacturer: 'ABB',
    model: 'UD/S 4.210.2.11',
    name: 'ABB LED Dimmaktor 4-fach REG',
    description: '4-Kanal Universal-Dimmaktor für Retrofit-LEDs und konventionelle Lasten (210 VA je Kanal)',
    trade: 'lighting',
    channels: [
      { channel_code: 'Kanal A', default_name: 'ABB Dimmkanal A', channel_type: 'DimmerOutput' },
      { channel_code: 'Kanal B', default_name: 'ABB Dimmkanal B', channel_type: 'DimmerOutput' },
      { channel_code: 'Kanal C', default_name: 'ABB Dimmkanal C', channel_type: 'DimmerOutput' },
      { channel_code: 'Kanal D', default_name: 'ABB Dimmkanal D', channel_type: 'DimmerOutput' },
    ],
  },
  {
    id: 'abb-jra-s-4-230',
    manufacturer: 'ABB',
    model: 'JRA/S 4.230.5.1',
    name: 'ABB Jalousie-/Rollladenaktor 4-fach',
    description: '4-fach Jalousieaktor mit manueller Vor-Ort-Bedienung und Endlagenerkennung',
    trade: 'shading',
    channels: [
      { channel_code: 'Kanal A', default_name: 'Jalousieantrieb A', channel_type: 'BlindOutput' },
      { channel_code: 'Kanal B', default_name: 'Jalousieantrieb B', channel_type: 'BlindOutput' },
      { channel_code: 'Kanal C', default_name: 'Jalousieantrieb C', channel_type: 'BlindOutput' },
      { channel_code: 'Kanal D', default_name: 'Jalousieantrieb D', channel_type: 'BlindOutput' },
    ],
  },
  {
    id: 'abb-us-u-4-2',
    manufacturer: 'ABB',
    model: 'US/U 4.2',
    name: 'ABB 4-fach Universalschnittstelle UP',
    description: '4-Kanal Binäreingang für Tasterkontakte oder Fenster-/Türkontakte in der Schalterdose',
    trade: 'universal',
    channels: [
      { channel_code: 'Eingang 1', default_name: 'Tasterkontakt 1', channel_type: 'PushButtonInput' },
      { channel_code: 'Eingang 2', default_name: 'Tasterkontakt 2', channel_type: 'PushButtonInput' },
      { channel_code: 'Eingang 3', default_name: 'Tasterkontakt 3', channel_type: 'PushButtonInput' },
      { channel_code: 'Eingang 4', default_name: 'Tasterkontakt 4', channel_type: 'PushButtonInput' },
    ],
  },
]

/**
 * Calculates the next free individual address in line 1.1 (e.g. "1.1.11")
 */
export function getNextIndividualAddress(existingDevices: KnxDevice[]): string {
  const occupiedNumbers = new Set<number>()

  existingDevices.forEach((device) => {
    const parts = device.individual_address.split('.')
    if (parts.length === 3 && parts[0] === '1' && parts[1] === '1') {
      const num = parseInt(parts[2], 10)
      if (!isNaN(num)) {
        occupiedNumbers.add(num)
      }
    }
  })

  // Find lowest free number starting from 1
  for (let i = 1; i <= 255; i++) {
    if (!occupiedNumbers.has(i)) {
      return `1.1.${i}`
    }
  }

  return '1.1.20'
}

/**
 * Creates a fully initialized KnxDevice from a catalog template
 */
export function createDeviceFromTemplate(
  template: CatalogDeviceTemplate,
  individualAddress: string,
  customName?: string,
  targetRoomId?: string | null
): KnxDevice {
  const deviceId = crypto.randomUUID()

  const channels: DeviceChannel[] = template.channels.map((chTpl) => ({
    id: crypto.randomUUID(),
    device_id: deviceId,
    channel_code: chTpl.channel_code,
    name: chTpl.default_name,
    channel_type: chTpl.channel_type,
    room_id: targetRoomId || null,
    position: null,
  }))

  return {
    id: deviceId,
    individual_address: individualAddress,
    manufacturer: template.manufacturer,
    model: template.model,
    name: customName || template.name,
    channels,
    position: null,
  }
}
