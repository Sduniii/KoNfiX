import { FunctionBlock, FunctionBlockType, BlockPin } from '../types/knx'

/**
 * Creates a new default FunctionBlock instance populated with standard pins,
 * parameters, initial state, and layout position based on the block type.
 */
export function createDefaultFunctionBlock(
  type: FunctionBlockType,
  blockCount: number,
  roomId: string | null,
  customPosition?: { x: number; y: number }
): FunctionBlock {
  const blockId = crypto.randomUUID()
  let name = 'Neuer Funktionsblock'
  let inputs: BlockPin[] = []
  let outputs: BlockPin[] = []
  let state: Record<string, any> = {}
  let parameters: Record<string, any> = {}

  switch (type) {
    case 'LightController':
      name = `Licht ${blockCount + 1}`
      inputs = [
        {
          id: 't',
          name: 'T (Toggle)',
          description: 'Taster-Eingang',
          dpt: '1.001',
          direction: 'Input',
          group_address_id: null,
        },
      ]
      outputs = [
        {
          id: 'sw',
          name: 'SW (Schalten)',
          description: 'Schaltbefehl',
          dpt: '1.001',
          direction: 'Output',
          group_address_id: null,
        },
        {
          id: 'val',
          name: 'VAL (Wert)',
          description: 'Dimmwert',
          dpt: '5.001',
          direction: 'Output',
          group_address_id: null,
        },
        {
          id: 'stat_sw',
          name: 'STAT (Status)',
          description: 'Status Schalten',
          dpt: '1.001',
          direction: 'Output',
          group_address_id: null,
        },
      ]
      state = { is_on: false, brightness: 0 }
      break

    case 'BlindController':
      name = `Jalousie ${blockCount + 1}`
      inputs = [
        {
          id: 'up',
          name: 'AUF',
          description: 'Auf',
          dpt: '1.008',
          direction: 'Input',
          group_address_id: null,
        },
        {
          id: 'down',
          name: 'AB',
          description: 'Ab',
          dpt: '1.008',
          direction: 'Input',
          group_address_id: null,
        },
      ]
      outputs = [
        {
          id: 'move',
          name: 'MOVE',
          description: 'Fahrt Auf/Ab',
          dpt: '1.008',
          direction: 'Output',
          group_address_id: null,
        },
        {
          id: 'pos',
          name: 'POS',
          description: 'Position 0-100%',
          dpt: '5.001',
          direction: 'Output',
          group_address_id: null,
        },
      ]
      state = { position: 0, slat: 0 }
      break

    case 'ClimateController':
      name = `Heizung ${blockCount + 1}`
      inputs = [
        {
          id: 't_act',
          name: 'T_IST',
          description: 'Ist-Temperatur',
          dpt: '9.001',
          direction: 'Input',
          group_address_id: null,
        },
      ]
      outputs = [
        {
          id: 't_set',
          name: 'SOLL',
          description: 'Soll-Temperatur',
          dpt: '9.001',
          direction: 'Output',
          group_address_id: null,
        },
        {
          id: 'heat_val',
          name: 'VENTIL',
          description: 'Ventil PWM',
          dpt: '5.001',
          direction: 'Output',
          group_address_id: null,
        },
      ]
      state = { target_temp: 21.0, act_temp: 20.5, valve_pwm: 30 }
      break

    case 'SceneController':
      name = `Lichtszenen ${blockCount + 1}`
      inputs = [
        {
          id: 'trig',
          name: 'TRIG',
          description: 'Szene weiterschalten',
          dpt: '1.001',
          direction: 'Input',
          group_address_id: null,
        },
        {
          id: 'prev',
          name: 'PREV',
          description: 'Vorherige Szene',
          dpt: '1.001',
          direction: 'Input',
          group_address_id: null,
        },
        {
          id: 'scene',
          name: 'SCN',
          description: 'Szene Direktanwahl',
          dpt: '18.001',
          direction: 'Input',
          group_address_id: null,
        },
        {
          id: 'all_off',
          name: 'AUS',
          description: 'Alles Aus',
          dpt: '1.001',
          direction: 'Input',
          group_address_id: null,
        },
      ]
      outputs = [
        {
          id: 'scene_ctrl',
          name: 'SCENE',
          description: 'Szenensteuerung',
          dpt: '18.001',
          direction: 'Output',
          group_address_id: null,
        },
        {
          id: 'all_off',
          name: 'AUS',
          description: 'Alles Aus Status',
          dpt: '1.001',
          direction: 'Output',
          group_address_id: null,
        },
        {
          id: 'ch1_val',
          name: 'CH1',
          description: 'Kreis 1 Dimmwert (0-100%)',
          dpt: '5.001',
          direction: 'Output',
          group_address_id: null,
        },
        {
          id: 'ch2_val',
          name: 'CH2',
          description: 'Kreis 2 Dimmwert (0-100%)',
          dpt: '5.001',
          direction: 'Output',
          group_address_id: null,
        },
        {
          id: 'ch3_val',
          name: 'CH3',
          description: 'Kreis 3 Dimmwert (0-100%)',
          dpt: '5.001',
          direction: 'Output',
          group_address_id: null,
        },
      ]
      parameters = {
        fade_time_sec: 1.5,
        circuits: [
          { id: 'c1', name: 'Decke', type: 'dimmer', color: '#f59e0b' },
          { id: 'c2', name: 'Wand', type: 'dimmer', color: '#ec4899' },
          { id: 'c3', name: 'Indirekt', type: 'dimmer', color: '#8b5cf6' },
          { id: 'c4', name: 'Esstisch', type: 'dimmer', color: '#06b6d4' },
        ],
        scenes: [
          { no: 1, name: 'Normal / Hell', icon: '☀️', fade_time: 1.5, values: { c1: 90, c2: 70, c3: 80, c4: 85 } },
          { no: 2, name: 'Kochen / Essen', icon: '🍳', fade_time: 1.5, values: { c1: 100, c2: 80, c3: 40, c4: 100 } },
          { no: 3, name: 'TV / Relax', icon: '🍿', fade_time: 2.0, values: { c1: 0, c2: 25, c3: 45, c4: 0 } },
          { no: 4, name: 'Nacht / Orientierung', icon: '🌙', fade_time: 2.5, values: { c1: 0, c2: 10, c3: 15, c4: 0 } },
          { no: 5, name: 'Alles Aus', icon: '🌑', fade_time: 1.0, values: { c1: 0, c2: 0, c3: 0, c4: 0 } },
        ],
      }
      state = {
        active_scene: 1,
        scene_name: 'Normal / Hell',
        scene_icon: '☀️',
        fader_values: { c1: 90, c2: 70, c3: 80, c4: 85 },
        is_all_off: false,
      }
      break

    case 'StaircaseTimer':
      name = `Treppenlicht ${blockCount + 1}`
      inputs = [
        {
          id: 'trig',
          name: 'TRIG',
          description: 'Taster-Eingang',
          dpt: '1.001',
          direction: 'Input',
          group_address_id: null,
        },
      ]
      outputs = [
        {
          id: 'sw',
          name: 'SW',
          description: 'Schaltbefehl',
          dpt: '1.001',
          direction: 'Output',
          group_address_id: null,
        },
      ]
      parameters = { duration_sec: 120 }
      state = { is_on: false, remaining_sec: 0 }
      break

    case 'LogicGate':
      name = `Logik ${blockCount + 1}`
      inputs = [
        {
          id: 'in1',
          name: 'IN1',
          description: 'Eingang 1',
          dpt: '1.001',
          direction: 'Input',
          group_address_id: null,
        },
        {
          id: 'in2',
          name: 'IN2',
          description: 'Eingang 2',
          dpt: '1.001',
          direction: 'Input',
          group_address_id: null,
        },
      ]
      outputs = [
        {
          id: 'out',
          name: 'OUT',
          description: 'Ausgang',
          dpt: '1.001',
          direction: 'Output',
          group_address_id: null,
        },
      ]
      parameters = { gate_type: 'AND' }
      state = { in1: false, in2: false, out: false }
      break

    case 'AstroSunProtection':
      name = `Astro Sonnenschutz ${blockCount + 1}`
      inputs = [
        {
          id: 'wind_speed',
          name: 'WIND',
          description: 'Windgeschwindigkeit (m/s)',
          dpt: '9.001',
          direction: 'Input',
          group_address_id: null,
        },
        {
          id: 'brightness',
          name: 'LUX',
          description: 'Helligkeit (Lux)',
          dpt: '9.001',
          direction: 'Input',
          group_address_id: null,
        },
        {
          id: 'rain',
          name: 'REGEN',
          description: 'Regenstatus (Ja/Nein)',
          dpt: '1.001',
          direction: 'Input',
          group_address_id: null,
        },
        {
          id: 'lock',
          name: 'SPERRE',
          description: 'Manuelle Sperre',
          dpt: '1.001',
          direction: 'Input',
          group_address_id: null,
        },
      ]
      outputs = [
        {
          id: 'wind_alarm',
          name: 'ALARM',
          description: 'Windalarm (1=Alarm)',
          dpt: '1.005',
          direction: 'Output',
          group_address_id: null,
        },
        {
          id: 'sun_active',
          name: 'SONNE',
          description: 'Sonnenschutz aktiv',
          dpt: '1.001',
          direction: 'Output',
          group_address_id: null,
        },
        {
          id: 'target_pos',
          name: 'POS',
          description: 'Soll-Position Jalousie %',
          dpt: '5.001',
          direction: 'Output',
          group_address_id: null,
        },
        {
          id: 'target_blade',
          name: 'LAMELLE',
          description: 'Soll-Winkel Lamelle %',
          dpt: '5.001',
          direction: 'Output',
          group_address_id: null,
        },
      ]
      parameters = {
        facade_orientation_deg: 180.0,
        wind_alarm_threshold: 12.0,
        sun_brightness_threshold: 35000.0,
        sun_elevation_min: 10.0,
        blind_protection_pos: 80,
        blade_protection_pos: 45,
      }
      state = {
        wind_speed: 3.2,
        rain: false,
        brightness: 42000,
        temp: 22.4,
        is_wind_alarm: false,
        is_sun_protecting: false,
        target_pos: 0,
        target_blade: 0,
      }
      break

    case 'TimerScheduler':
      name = `Zeitschaltuhr ${blockCount + 1}`
      inputs = [
        {
          id: 'enable',
          name: 'EN',
          description: 'Freigabe',
          dpt: '1.001',
          direction: 'Input',
          group_address_id: null,
        },
      ]
      outputs = [
        {
          id: 'out',
          name: 'OUT',
          description: 'Schaltausgang',
          dpt: '1.001',
          direction: 'Output',
          group_address_id: null,
        },
      ]
      parameters = {
        on_time: '07:00',
        off_time: '22:00',
        active_days: [1, 2, 3, 4, 5],
      }
      state = { enabled: true, is_active: false, current_time: '12:00' }
      break

    case 'ThresholdSwitch':
      name = `Schwellwert ${blockCount + 1}`
      inputs = [
        {
          id: 'in_val',
          name: 'IN',
          description: 'Analoger Messwert',
          dpt: '9.001',
          direction: 'Input',
          group_address_id: null,
        },
      ]
      outputs = [
        {
          id: 'out',
          name: 'OUT',
          description: 'Schaltausgang Hysterese',
          dpt: '1.001',
          direction: 'Output',
          group_address_id: null,
        },
      ]
      parameters = {
        threshold_on: 24.0,
        threshold_off: 22.0,
        direction: 'Above',
      }
      state = { in_val: 21.5, out: false }
      break

    default:
      name = `Block ${blockCount + 1}`
      break
  }

  return {
    id: blockId,
    name,
    block_type: type,
    room_id: roomId,
    position: customPosition || { x: 380, y: 150 + blockCount * 180 },
    inputs,
    outputs,
    parameters,
    state,
  }
}
