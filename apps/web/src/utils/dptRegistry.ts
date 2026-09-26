// KNX Datapoint Types (DPT) Registry
// Compliant with KNX Standard 03/07/02 Datapoint Types v02.02.01 AS and KNX Master XML

export interface DptInfo {
  dpt: string
  name: string
  descriptionDe: string
  unit: string
  format: string // e.g. "B1", "U8", "U16", "V16", "F16", "U32", "V32", "F32", "RGB"
  isFloat: boolean
  min?: number
  max?: number
  step?: number
  groupDe: string
}

export const STANDARD_DPTS: Record<string, DptInfo> = {
  // --- DPT 1: 1-Bit (B1) ---
  '1.001': {
    dpt: '1.001',
    name: 'DPT_Switch',
    descriptionDe: 'Schalten (Ein / Aus)',
    unit: '',
    format: 'B1',
    isFloat: false,
    min: 0,
    max: 1,
    step: 1,
    groupDe: '1-Bit Binär',
  },
  '1.002': {
    dpt: '1.002',
    name: 'DPT_Bool',
    descriptionDe: 'Boolesch (Wahr / Falsch)',
    unit: '',
    format: 'B1',
    isFloat: false,
    min: 0,
    max: 1,
    step: 1,
    groupDe: '1-Bit Binär',
  },
  '1.003': {
    dpt: '1.003',
    name: 'DPT_Enable',
    descriptionDe: 'Freigabe (Aktivieren / Deaktivieren)',
    unit: '',
    format: 'B1',
    isFloat: false,
    min: 0,
    max: 1,
    step: 1,
    groupDe: '1-Bit Binär',
  },
  '1.008': {
    dpt: '1.008',
    name: 'DPT_UpDown',
    descriptionDe: 'Jalousie / Behang Auf/Ab',
    unit: '',
    format: 'B1',
    isFloat: false,
    min: 0,
    max: 1,
    step: 1,
    groupDe: '1-Bit Jalousie',
  },
  '1.009': {
    dpt: '1.009',
    name: 'DPT_OpenClose',
    descriptionDe: 'Öffnen / Schließen',
    unit: '',
    format: 'B1',
    isFloat: false,
    min: 0,
    max: 1,
    step: 1,
    groupDe: '1-Bit Jalousie',
  },
  '1.010': {
    dpt: '1.010',
    name: 'DPT_Start',
    descriptionDe: 'Start / Stop',
    unit: '',
    format: 'B1',
    isFloat: false,
    min: 0,
    max: 1,
    step: 1,
    groupDe: '1-Bit Steuerung',
  },
  '1.011': {
    dpt: '1.011',
    name: 'DPT_State',
    descriptionDe: 'Statusanzeige (Aktiv / Inaktiv)',
    unit: '',
    format: 'B1',
    isFloat: false,
    min: 0,
    max: 1,
    step: 1,
    groupDe: '1-Bit Status',
  },
  '1.018': {
    dpt: '1.018',
    name: 'DPT_Occupancy',
    descriptionDe: 'Präsenz / Anwesenheit',
    unit: '',
    format: 'B1',
    isFloat: false,
    min: 0,
    max: 1,
    step: 1,
    groupDe: '1-Bit Sensorik',
  },

  // --- DPT 2: 2-Bit (B2) ---
  '2.001': {
    dpt: '2.001',
    name: 'DPT_Switch_Control',
    descriptionDe: 'Schalten mit Prioritätszwang',
    unit: '',
    format: 'B2',
    isFloat: false,
    min: 0,
    max: 3,
    step: 1,
    groupDe: '2-Bit Zwangsführung',
  },

  // --- DPT 3: 4-Bit Dimm-/Fahr-Schritt (B4) ---
  '3.007': {
    dpt: '3.007',
    name: 'DPT_Control_Dimming',
    descriptionDe: 'Relatives Dimmen (Heller / Dunkler)',
    unit: 'Schritt',
    format: 'B4',
    isFloat: false,
    min: 0,
    max: 15,
    step: 1,
    groupDe: '4-Bit Dimmen',
  },
  '3.008': {
    dpt: '3.008',
    name: 'DPT_Control_Blinds',
    descriptionDe: 'Lamellenverstellung Auf/Ab',
    unit: 'Schritt',
    format: 'B4',
    isFloat: false,
    min: 0,
    max: 15,
    step: 1,
    groupDe: '4-Bit Jalousie',
  },

  // --- DPT 5: 8-Bit Unsigned (U8) ---
  '5.001': {
    dpt: '5.001',
    name: 'DPT_Scaling',
    descriptionDe: 'Prozentwert (0 .. 100 %)',
    unit: '%',
    format: 'U8',
    isFloat: false,
    min: 0,
    max: 100,
    step: 1,
    groupDe: '8-Bit Prozent',
  },
  '5.003': {
    dpt: '5.003',
    name: 'DPT_Angle',
    descriptionDe: 'Winkelgrad (0 .. 360 °)',
    unit: '°',
    format: 'U8',
    isFloat: false,
    min: 0,
    max: 360,
    step: 1,
    groupDe: '8-Bit Winkel',
  },
  '5.004': {
    dpt: '5.004',
    name: 'DPT_Percent_U8',
    descriptionDe: 'Prozentwert absolut (0 .. 255 %)',
    unit: '%',
    format: 'U8',
    isFloat: false,
    min: 0,
    max: 255,
    step: 1,
    groupDe: '8-Bit Skalierung',
  },
  '5.010': {
    dpt: '5.010',
    name: 'DPT_Value_1_Ucount',
    descriptionDe: 'Zähler 8-Bit (0 .. 255)',
    unit: 'Impulse',
    format: 'U8',
    isFloat: false,
    min: 0,
    max: 255,
    step: 1,
    groupDe: '8-Bit Ganzzahl',
  },

  // --- DPT 6: 8-Bit Signed (V8) ---
  '6.001': {
    dpt: '6.001',
    name: 'DPT_Value_1_Count',
    descriptionDe: 'Vorzeichenbehafteter Zähler (-128 .. 127)',
    unit: 'Impulse',
    format: 'V8',
    isFloat: false,
    min: -128,
    max: 127,
    step: 1,
    groupDe: '8-Bit Vorzeichen',
  },

  // --- DPT 7: 2-Octet Unsigned (U16) - Strictly Integer! ---
  '7.001': {
    dpt: '7.001',
    name: 'DPT_Value_2_Ucount',
    descriptionDe: 'Impulszähler (0 .. 65.535)',
    unit: 'Impulse',
    format: 'U16',
    isFloat: false,
    min: 0,
    max: 65535,
    step: 1,
    groupDe: '2-Byte Ganzzahl',
  },
  '7.002': {
    dpt: '7.002',
    name: 'DPT_TimePeriodMsec',
    descriptionDe: 'Zeitspanne in Millisekunden (0 .. 65.535 ms)',
    unit: 'ms',
    format: 'U16',
    isFloat: false,
    min: 0,
    max: 65535,
    step: 1,
    groupDe: '2-Byte Zeit (Ganzzahl)',
  },
  '7.003': {
    dpt: '7.003',
    name: 'DPT_TimePeriod10Msec',
    descriptionDe: 'Zeitspanne 10 Millisekunden',
    unit: 'cs',
    format: 'U16',
    isFloat: false,
    min: 0,
    max: 65535,
    step: 1,
    groupDe: '2-Byte Zeit (Ganzzahl)',
  },
  '7.004': {
    dpt: '7.004',
    name: 'DPT_TimePeriod100Msec',
    descriptionDe: 'Zeitspanne 100 Millisekunden',
    unit: 'ds',
    format: 'U16',
    isFloat: false,
    min: 0,
    max: 65535,
    step: 1,
    groupDe: '2-Byte Zeit (Ganzzahl)',
  },
  '7.005': {
    dpt: '7.005',
    name: 'DPT_TimePeriodSec',
    descriptionDe: 'Zeitspanne / Verfahrzeit (0 .. 65.535 s)',
    unit: 's',
    format: 'U16',
    isFloat: false,
    min: 0,
    max: 65535,
    step: 1,
    groupDe: '2-Byte Zeit (Ganzzahl)',
  },
  '7.006': {
    dpt: '7.006',
    name: 'DPT_TimePeriodMin',
    descriptionDe: 'Zeitspanne in Minuten (0 .. 65.535 min)',
    unit: 'min',
    format: 'U16',
    isFloat: false,
    min: 0,
    max: 65535,
    step: 1,
    groupDe: '2-Byte Zeit (Ganzzahl)',
  },
  '7.007': {
    dpt: '7.007',
    name: 'DPT_TimePeriodHrs',
    descriptionDe: 'Zeitspanne in Stunden (0 .. 65.535 h)',
    unit: 'h',
    format: 'U16',
    isFloat: false,
    min: 0,
    max: 65535,
    step: 1,
    groupDe: '2-Byte Zeit (Ganzzahl)',
  },
  '7.011': {
    dpt: '7.011',
    name: 'DPT_Length_mm',
    descriptionDe: 'Länge in Millimeter (0 .. 65.535 mm)',
    unit: 'mm',
    format: 'U16',
    isFloat: false,
    min: 0,
    max: 65535,
    step: 1,
    groupDe: '2-Byte Ganzzahl',
  },
  '7.012': {
    dpt: '7.012',
    name: 'DPT_Current_mA',
    descriptionDe: 'Elektrischer Strom in mA (0 .. 65.535 mA)',
    unit: 'mA',
    format: 'U16',
    isFloat: false,
    min: 0,
    max: 65535,
    step: 1,
    groupDe: '2-Byte Ganzzahl',
  },
  '7.013': {
    dpt: '7.013',
    name: 'DPT_Brightness',
    descriptionDe: 'Helligkeit in Lux (0 .. 65.535 Lux)',
    unit: 'Lux',
    format: 'U16',
    isFloat: false,
    min: 0,
    max: 65535,
    step: 1,
    groupDe: '2-Byte Helligkeit',
  },

  // --- DPT 8: 2-Octet Signed (V16) ---
  '8.001': {
    dpt: '8.001',
    name: 'DPT_Value_2_Count',
    descriptionDe: 'Differenz-Zähler (-32.768 .. 32.767)',
    unit: 'Impulse',
    format: 'V16',
    isFloat: false,
    min: -32768,
    max: 32767,
    step: 1,
    groupDe: '2-Byte Vorzeichen',
  },
  '8.002': {
    dpt: '8.002',
    name: 'DPT_DeltaTimeMsec',
    descriptionDe: 'Zeitdifferenz in ms (-32.768 .. 32.767 ms)',
    unit: 'ms',
    format: 'V16',
    isFloat: false,
    min: -32768,
    max: 32767,
    step: 1,
    groupDe: '2-Byte Vorzeichen',
  },
  '8.005': {
    dpt: '8.005',
    name: 'DPT_DeltaTimeSec',
    descriptionDe: 'Zeitdifferenz in Sekunden (-32.768 .. 32.767 s)',
    unit: 's',
    format: 'V16',
    isFloat: false,
    min: -32768,
    max: 32767,
    step: 1,
    groupDe: '2-Byte Vorzeichen',
  },

  // --- DPT 9: 2-Octet Float (F16) ---
  '9.001': {
    dpt: '9.001',
    name: 'DPT_Value_Temp',
    descriptionDe: 'Temperatur (-273 .. +670.760 °C)',
    unit: '°C',
    format: 'F16',
    isFloat: true,
    min: -273.0,
    max: 670760.0,
    step: 0.1,
    groupDe: '2-Byte Fließkomma',
  },
  '9.002': {
    dpt: '9.002',
    name: 'DPT_Value_Tempd',
    descriptionDe: 'Temperaturdifferenz (Kelvin)',
    unit: 'K',
    format: 'F16',
    isFloat: true,
    step: 0.1,
    groupDe: '2-Byte Fließkomma',
  },
  '9.004': {
    dpt: '9.004',
    name: 'DPT_Value_Lux',
    descriptionDe: 'Beleuchtungsstärke (0 .. 670.760 Lux)',
    unit: 'Lux',
    format: 'F16',
    isFloat: true,
    min: 0,
    max: 670760,
    step: 1.0,
    groupDe: '2-Byte Helligkeit',
  },
  '9.005': {
    dpt: '9.005',
    name: 'DPT_Value_Ws',
    descriptionDe: 'Windgeschwindigkeit (0 .. 670.760 m/s)',
    unit: 'm/s',
    format: 'F16',
    isFloat: true,
    min: 0,
    max: 670760,
    step: 0.1,
    groupDe: '2-Byte Fließkomma',
  },
  '9.006': {
    dpt: '9.006',
    name: 'DPT_Value_Pres',
    descriptionDe: 'Luftdruck (0 .. 670.760 Pa)',
    unit: 'Pa',
    format: 'F16',
    isFloat: true,
    min: 0,
    max: 670760,
    step: 1.0,
    groupDe: '2-Byte Fließkomma',
  },
  '9.007': {
    dpt: '9.007',
    name: 'DPT_Value_Humidity',
    descriptionDe: 'Relative Luftfeuchtigkeit (0 .. 100 %)',
    unit: '%',
    format: 'F16',
    isFloat: true,
    min: 0,
    max: 100,
    step: 0.5,
    groupDe: '2-Byte Fließkomma',
  },
  '9.008': {
    dpt: '9.008',
    name: 'DPT_Value_AirQuality',
    descriptionDe: 'Luftqualität / CO2-Konzentration',
    unit: 'ppm',
    format: 'F16',
    isFloat: true,
    min: 0,
    max: 670760,
    step: 1.0,
    groupDe: '2-Byte Fließkomma',
  },

  // --- DPT 10: Zeit (3 Byte) ---
  '10.001': {
    dpt: '10.001',
    name: 'DPT_TimeOfDay',
    descriptionDe: 'Uhrzeit (Wochentag, Stunde:Minute:Sekunde)',
    unit: '',
    format: '3-Byte Time',
    isFloat: false,
    groupDe: 'Uhrzeit / Datum',
  },

  // --- DPT 11: Datum (3 Byte) ---
  '11.001': {
    dpt: '11.001',
    name: 'DPT_Date',
    descriptionDe: 'Kalenderdatum (Tag, Monat, Jahr)',
    unit: '',
    format: '3-Byte Date',
    isFloat: false,
    groupDe: 'Uhrzeit / Datum',
  },

  // --- DPT 12: 4-Octet Unsigned (U32) ---
  '12.001': {
    dpt: '12.001',
    name: 'DPT_Value_4_Ucount',
    descriptionDe: 'Großer Zähler (0 .. 4.294.967.295)',
    unit: 'Impulse',
    format: 'U32',
    isFloat: false,
    min: 0,
    max: 4294967295,
    step: 1,
    groupDe: '4-Byte Ganzzahl',
  },

  // --- DPT 13: 4-Octet Signed (V32) ---
  '13.001': {
    dpt: '13.001',
    name: 'DPT_Value_4_Count',
    descriptionDe: 'Großer Differenzzähler (-2.147.483.648 .. 2.147.483.647)',
    unit: 'Impulse',
    format: 'V32',
    isFloat: false,
    min: -2147483648,
    max: 2147483647,
    step: 1,
    groupDe: '4-Byte Vorzeichen',
  },
  '13.010': {
    dpt: '13.010',
    name: 'DPT_ActiveEnergy',
    descriptionDe: 'Wirkenergie (Wh)',
    unit: 'Wh',
    format: 'V32',
    isFloat: false,
    step: 1,
    groupDe: '4-Byte Energie',
  },
  '13.013': {
    dpt: '13.013',
    name: 'DPT_ActiveEnergy_kWh',
    descriptionDe: 'Wirkenergie (Kilowattstunden)',
    unit: 'kWh',
    format: 'V32',
    isFloat: false,
    step: 1,
    groupDe: '4-Byte Energie',
  },

  // --- DPT 14: 4-Octet Float IEEE 754 (F32) ---
  '14.056': {
    dpt: '14.056',
    name: 'DPT_Value_Power',
    descriptionDe: 'Wirkleistung in Watt',
    unit: 'W',
    format: 'F32',
    isFloat: true,
    step: 0.1,
    groupDe: '4-Byte Fließkomma',
  },
  '14.068': {
    dpt: '14.068',
    name: 'DPT_Value_Electric_Current',
    descriptionDe: 'Elektrische Stromstärke (Ampere)',
    unit: 'A',
    format: 'F32',
    isFloat: true,
    step: 0.01,
    groupDe: '4-Byte Fließkomma',
  },
  '14.027': {
    dpt: '14.027',
    name: 'DPT_Value_Electric_Potential',
    descriptionDe: 'Elektrische Spannung (Volt)',
    unit: 'V',
    format: 'F32',
    isFloat: true,
    step: 0.1,
    groupDe: '4-Byte Fließkomma',
  },

  // --- DPT 16: Zeichenkette (14 Byte ASCII) ---
  '16.000': {
    dpt: '16.000',
    name: 'DPT_String_ASCII',
    descriptionDe: 'ASCII-Zeichenkette (max. 14 Zeichen)',
    unit: '',
    format: '14-Byte String',
    isFloat: false,
    groupDe: 'Text',
  },
  '16.001': {
    dpt: '16.001',
    name: 'DPT_String_8859_1',
    descriptionDe: 'ISO-8859-1 Zeichenkette',
    unit: '',
    format: '14-Byte String',
    isFloat: false,
    groupDe: 'Text',
  },

  // --- DPT 17: Szenennummer (1 Byte) ---
  '17.001': {
    dpt: '17.001',
    name: 'DPT_SceneNumber',
    descriptionDe: 'Szenennummer (1 .. 64)',
    unit: '',
    format: 'U8',
    isFloat: false,
    min: 1,
    max: 64,
    step: 1,
    groupDe: 'Szenen',
  },

  // --- DPT 18: Szenensteuerung (1 Byte) ---
  '18.001': {
    dpt: '18.001',
    name: 'DPT_SceneControl',
    descriptionDe: 'Szenensteuerung (Aufrufen / Speichern 1 .. 64)',
    unit: '',
    format: 'U8',
    isFloat: false,
    min: 1,
    max: 64,
    step: 1,
    groupDe: 'Szenen',
  },

  // --- DPT 20: Betriebsart (1 Byte) ---
  '20.102': {
    dpt: '20.102',
    name: 'DPT_HVACMode',
    descriptionDe: 'HVAC-Betriebsart (Auto, Komfort, Standby, Nacht, Frost)',
    unit: '',
    format: 'U8',
    isFloat: false,
    min: 0,
    max: 4,
    step: 1,
    groupDe: 'Heizung / Klima',
  },

  // --- DPT 232: Farbmodell (3 Byte RGB) ---
  '232.600': {
    dpt: '232.600',
    name: 'DPT_Colour_RGB',
    descriptionDe: 'RGB-Farbwert (Rot, Grün, Blau 0..255)',
    unit: '',
    format: '3-Byte RGB',
    isFloat: false,
    groupDe: 'Farbe',
  },
}

/**
 * Normalizes any DPT string: e.g. "DPST-7-5" -> "7.005", "DPT-9" -> "9.001", "7" -> "7.001"
 */
export function normalizeDpt(raw: string): string {
  if (!raw) return '1.001'
  let clean = raw.trim()

  // Match DPST-X-Y or DPT-X
  if (clean.includes('DPST-') || clean.includes('DPT-')) {
    const parts = clean.split('-')
    if (parts.length >= 3) {
      const main = parseInt(parts[1], 10)
      const sub = parseInt(parts[2], 10)
      if (!isNaN(main) && !isNaN(sub)) {
        return `${main}.${sub.toString().padStart(3, '0')}`
      }
    } else if (parts.length === 2) {
      const main = parseInt(parts[1], 10)
      if (!isNaN(main)) {
        return `${main}.001`
      }
    }
  }

  // If already "7.005"
  if (clean.includes('.')) {
    const parts = clean.split('.')
    const main = parseInt(parts[0], 10)
    const sub = parseInt(parts[1], 10)
    if (!isNaN(main) && !isNaN(sub)) {
      return `${main}.${sub.toString().padStart(3, '0')}`
    }
  }

  // If just a number like "7"
  const num = parseInt(clean, 10)
  if (!isNaN(num)) {
    return `${num}.001`
  }

  return clean
}

/**
 * Look up full DPT metadata by DPT string
 */
export function lookupDpt(dpt: string): DptInfo | undefined {
  const norm = normalizeDpt(dpt)
  if (STANDARD_DPTS[norm]) {
    return STANDARD_DPTS[norm]
  }

  // Fallback to main group default if sub-type not found
  const mainGroup = norm.split('.')[0]
  const defaultSub = `${mainGroup}.001`
  return STANDARD_DPTS[defaultSub]
}

/**
 * Format a DPT value cleanly for UI display
 */
export function formatDptDisplay(dpt: string, value: any): string {
  const meta = lookupDpt(dpt)
  if (!meta) {
    return value !== undefined && value !== null ? String(value) : '–'
  }

  if (meta.dpt.startsWith('1.')) {
    const boolVal = typeof value === 'boolean' ? value : String(value) === '1' || String(value).toLowerCase() === 'true'
    if (meta.dpt === '1.008') return boolVal ? 'Ab (1)' : 'Auf (0)'
    if (meta.dpt === '1.010') return boolVal ? 'Start (1)' : 'Stop (0)'
    if (meta.dpt === '1.009') return boolVal ? 'Schließen (1)' : 'Öffnen (0)'
    return boolVal ? 'EIN (1)' : 'AUS (0)'
  }

  if (meta.dpt === '5.001') {
    return `${Math.round(Number(value) || 0)} %`
  }

  if (meta.unit) {
    if (meta.isFloat) {
      const num = Number(value)
      return isNaN(num) ? `${value} ${meta.unit}` : `${num.toFixed(1)} ${meta.unit}`
    } else {
      return `${Math.round(Number(value) || 0)} ${meta.unit}`
    }
  }

  return String(value)
}
