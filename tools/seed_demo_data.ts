import fs from 'fs'
import path from 'path'
import os from 'os'

const projectFiles = ['KNX_Projekt_Test.konfix', 'Demo.konfix']

for (const fileName of projectFiles) {
  const projectPath = path.join(os.homedir(), '.konfix', 'projects', fileName)
  if (!fs.existsSync(projectPath)) continue

  const raw = fs.readFileSync(projectPath, 'utf8')
  const project = JSON.parse(raw)

  const floorId = project.floors?.[0]?.id || 'c69d8ec4-a6c0-4abd-ac6a-7667473e2573'
  const wohnenRoom = project.rooms?.find((r: any) => r.name.includes('Wohnen') || r.name.includes('Wohnzimmer'))?.id || project.rooms?.[0]?.id

  // 1. Function Blocks
  const blockAstroId = 'a1111111-1111-4111-8111-111111111111'
  const blockBlindId = 'b2222222-2222-4222-8222-222222222222'
  const blockLightId = 'c3333333-3333-4333-8333-333333333333'
  const blockSceneId = 'd4444444-4444-4444-8444-444444444444'

  project.blocks = [
    {
      id: blockAstroId,
      name: 'Astro-Sonnenschutz Süd',
      block_type: 'AstroSunProtection',
      room_id: wohnenRoom,
      position: { x: 120, y: 100 },
      inputs: [
        { id: 'in_azimuth', name: 'Azimut', description: 'Sonnenazimut NOAA', dpt: '9.001', direction: 'Input', group_address_id: null },
        { id: 'in_elevation', name: 'Elevation', description: 'Sonnenelevation', dpt: '9.001', direction: 'Input', group_address_id: null },
        { id: 'in_lux', name: 'Helligkeit', description: 'Außenlux Wetterstation', dpt: '9.001', direction: 'Input', group_address_id: null },
        { id: 'in_auto', name: 'Automatik', description: 'Automatik Freigabe', dpt: '1.001', direction: 'Input', group_address_id: null }
      ],
      outputs: [
        { id: 'out_active', name: 'SchattenAktiv', description: 'Beschattung aktiviert', dpt: '1.001', direction: 'Output', group_address_id: null },
        { id: 'out_slat', name: 'ZielLamelle', description: 'Berechneter Lamellenwinkel', dpt: '5.001', direction: 'Output', group_address_id: null },
        { id: 'out_height', name: 'ZielHöhe', description: 'Behanghöhe', dpt: '5.001', direction: 'Output', group_address_id: null }
      ],
      parameters: {
        azimuth_min: 130,
        azimuth_max: 235,
        elevation_min: 12,
        lux_threshold: 30000,
        building_direction: 180
      },
      state: {
        is_active: true,
        current_elevation: 32.4,
        current_azimuth: 184.2,
        lux: 48500
      }
    },
    {
      id: blockBlindId,
      name: 'Jalousie Wohnzimmer Süd',
      block_type: 'BlindController',
      room_id: wohnenRoom,
      position: { x: 560, y: 100 },
      inputs: [
        { id: 'in_updown', name: 'Auf/Ab', description: 'Manueller Fahrbefehl', dpt: '1.008', direction: 'Input', group_address_id: null },
        { id: 'in_stop', name: 'Stop/Schritt', description: 'Stop oder Lamellenstep', dpt: '1.008', direction: 'Input', group_address_id: null },
        { id: 'in_shadow', name: 'Beschattung', description: 'Astro-Automatik Eingang', dpt: '1.001', direction: 'Input', group_address_id: null },
        { id: 'in_target_slat', name: 'LamelleVorgabe', description: 'Sonnennachführung %', dpt: '5.001', direction: 'Input', group_address_id: null }
      ],
      outputs: [
        { id: 'out_cmd', name: 'Fahrbefehl', description: 'Telegramm an Aktor', dpt: '1.008', direction: 'Output', group_address_id: null },
        { id: 'out_pos_cur', name: 'PositionIst', description: 'Aktuelle Position', dpt: '5.001', direction: 'Output', group_address_id: null },
        { id: 'out_slat_cur', name: 'LamelleIst', description: 'Aktuelle Lamelle', dpt: '5.001', direction: 'Output', group_address_id: null }
      ],
      parameters: {
        drive_time_s: 48,
        slat_time_ms: 1200
      },
      state: {
        position: 75,
        slat: 40,
        is_moving: false
      }
    },
    {
      id: blockLightId,
      name: 'Studio-Lichtmischpult Wohnen',
      block_type: 'LightController',
      room_id: wohnenRoom,
      position: { x: 120, y: 520 },
      inputs: [
        { id: 'in_sw', name: 'TasterSchalten', description: 'Wandtaster 1.1.5', dpt: '1.001', direction: 'Input', group_address_id: null },
        { id: 'in_dim', name: 'TasterDimmen', description: 'Relative Dimmung', dpt: '3.007', direction: 'Input', group_address_id: null },
        { id: 'in_scene', name: 'Szene', description: 'Szenennummer', dpt: '17.001', direction: 'Input', group_address_id: null }
      ],
      outputs: [
        { id: 'out_sw', name: 'Schaltausgang', description: 'Status Schalten', dpt: '1.001', direction: 'Output', group_address_id: null },
        { id: 'out_bri', name: 'Helligkeit', description: 'Absoluter Dimmwert', dpt: '5.001', direction: 'Output', group_address_id: null }
      ],
      parameters: {
        fade_time: 3,
        circuits: 3
      },
      state: {
        brightness: 85,
        is_on: true
      }
    },
    {
      id: blockSceneId,
      name: 'Szenensteuerung Wohnbereich',
      block_type: 'SceneController',
      room_id: wohnenRoom,
      position: { x: 560, y: 520 },
      inputs: [
        { id: 'in_scene_call', name: 'SzeneAbrufen', description: 'ETS Szenenaufruf', dpt: '18.001', direction: 'Input', group_address_id: null }
      ],
      outputs: [
        { id: 'out_scene_no', name: 'SzeneNummer', description: 'Aktive Szenennummer', dpt: '17.001', direction: 'Output', group_address_id: null }
      ],
      parameters: {},
      state: {
        active_scene: 2,
        active_name: 'Kino / Gemütlich'
      }
    }
  ]

  // 2. Wire Connections
  project.connections = [
    {
      id: 'w1111111-1111-4111-8111-111111111111',
      from_node_id: blockAstroId,
      from_pin: 'out_active',
      to_node_id: blockBlindId,
      to_pin: 'in_shadow'
    },
    {
      id: 'w2222222-2222-4222-8222-222222222222',
      from_node_id: blockAstroId,
      from_pin: 'out_slat',
      to_node_id: blockBlindId,
      to_pin: 'in_target_slat'
    },
    {
      id: 'w3333333-3333-4333-8333-333333333333',
      from_node_id: blockSceneId,
      from_pin: 'out_scene_no',
      to_node_id: blockLightId,
      to_pin: 'in_scene'
    }
  ]

  // 3. 2D CAD Floorplan (Walls, Doors, Windows, Widgets)
  const wall1 = 'f1111111-1111-4111-8111-111111111111'
  const wall2 = 'f2222222-2222-4222-8222-222222222222'
  const wall3 = 'f3333333-3333-4333-8333-333333333333'
  const wall4 = 'f4444444-4444-4444-8444-444444444444'
  const wall5 = 'f5555555-5555-4555-8555-555555555555'
  const wall6 = 'f6666666-6666-4666-8666-666666666666'

  project.floor_plans = [
    {
      floor_id: floorId,
      background_image: null,
      background_opacity: 0.5,
      cad_model: {
        walls: [
          { id: wall1, x1: 2.0, y1: 2.0, x2: 18.0, y2: 2.0, thickness: 0.36, is_outer: true },
          { id: wall2, x1: 18.0, y1: 2.0, x2: 18.0, y2: 14.0, thickness: 0.36, is_outer: true },
          { id: wall3, x1: 18.0, y1: 14.0, x2: 2.0, y2: 14.0, thickness: 0.36, is_outer: true },
          { id: wall4, x1: 2.0, y1: 14.0, x2: 2.0, y2: 2.0, thickness: 0.36, is_outer: true },
          { id: wall5, x1: 10.0, y1: 2.0, x2: 10.0, y2: 14.0, thickness: 0.24, is_outer: false },
          { id: wall6, x1: 2.0, y1: 8.0, x2: 10.0, y2: 8.0, thickness: 0.175, is_outer: false }
        ],
        openings: [
          { id: 'op111111-1111-4111-8111-111111111111', wall_id: wall1, opening_type: 'Window', position: 0.35, width: 2.4, flip: false },
          { id: 'op222222-2222-4222-8222-222222222222', wall_id: wall1, opening_type: 'Window', position: 0.75, width: 1.8, flip: false },
          { id: 'op333333-3333-4333-8333-333333333333', wall_id: wall4, opening_type: 'Door', position: 0.5, width: 1.0, flip: false },
          { id: 'op444444-4444-4444-8444-444444444444', wall_id: wall5, opening_type: 'Door', position: 0.35, width: 0.9, flip: false },
          { id: 'op555555-5555-4555-8555-555555555555', wall_id: wall6, opening_type: 'Door', position: 0.6, width: 0.9, flip: true },
          { id: 'op666666-6666-4666-8666-666666666666', wall_id: wall2, opening_type: 'Window', position: 0.5, width: 3.0, flip: false }
        ],
        room_zones: [
          {
            id: 'rz111111-1111-4111-8111-111111111111',
            room_id: wohnenRoom,
            name: 'Wohnen & Essen (48.0 m²)',
            points: [
              { x: 2.0, y: 2.0 },
              { x: 10.0, y: 2.0 },
              { x: 10.0, y: 8.0 },
              { x: 2.0, y: 8.0 }
            ],
            area_sqm: 48.0
          },
          {
            id: 'rz222222-2222-4222-8222-222222222222',
            room_id: null,
            name: 'Küche (36.0 m²)',
            points: [
              { x: 2.0, y: 8.0 },
              { x: 10.0, y: 8.0 },
              { x: 10.0, y: 14.0 },
              { x: 2.0, y: 14.0 }
            ],
            area_sqm: 36.0
          },
          {
            id: 'rz333333-3333-4333-8333-333333333333',
            room_id: null,
            name: 'Flur & Master-Schlafzimmer (72.0 m²)',
            points: [
              { x: 10.0, y: 2.0 },
              { x: 18.0, y: 2.0 },
              { x: 18.0, y: 14.0 },
              { x: 10.0, y: 14.0 }
            ],
            area_sqm: 72.0
          }
        ],
        scale_pixels_per_meter: 40.0
      },
      widgets: [
        {
          id: 'wgt11111-1111-4111-8111-111111111111',
          floor_id: floorId,
          room_id: wohnenRoom,
          title: 'Deckenlicht Wohnzimmer',
          widget_type: 'Light',
          x: 6.0,
          y: 4.5,
          ga_switch: '4/0/15',
          ga_state: '4/0/15',
          ga_value: null,
          dpt: '1.001'
        },
        {
          id: 'wgt22222-2222-4222-8222-222222222222',
          floor_id: floorId,
          room_id: wohnenRoom,
          title: 'Raffstore Süd Links',
          widget_type: 'Blind',
          x: 3.2,
          y: 2.0,
          ga_switch: '2/0/0',
          ga_state: '2/0/0',
          ga_value: null,
          dpt: '1.008'
        },
        {
          id: 'wgt33333-3333-4333-8333-333333333333',
          floor_id: floorId,
          room_id: wohnenRoom,
          title: 'Fußbodenheizung',
          widget_type: 'Climate',
          x: 8.5,
          y: 6.0,
          ga_switch: null,
          ga_state: '0/0/1',
          ga_value: null,
          dpt: '9.001'
        },
        {
          id: 'wgt44444-4444-4444-8444-444444444444',
          floor_id: floorId,
          room_id: null,
          title: 'Küche Esstisch LEDs',
          widget_type: 'Light',
          x: 6.0,
          y: 11.0,
          ga_switch: '4/0/41',
          ga_state: '4/0/41',
          ga_value: null,
          dpt: '1.001'
        }
      ]
    }
  ]

  fs.writeFileSync(projectPath, JSON.stringify(project, null, 2), 'utf8')
  console.log(`✓ Successfully enriched ${fileName} with floor plan for floor ${floorId}`)
}
