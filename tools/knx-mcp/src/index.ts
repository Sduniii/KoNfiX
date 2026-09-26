#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const API_BASE = process.env.KONFIX_API_URL?.replace(/\/$/, '') || 'http://localhost:8080/api';

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => res.statusText);
    throw new Error(`KoNfiX API Fehler (${res.status} ${res.statusText}): ${errorText}`);
  }

  return res.json() as Promise<T>;
}

const server = new McpServer({
  name: 'konfix-knx',
  version: '1.0.0',
});

function registerTool(name: string, config: any, cb: (args: any) => Promise<any>) {
  (server as any).registerTool(name, config, cb);
}

// Tool 1: Live KNX Bus Status
registerTool(
  'knx_get_bus_status',
  {
    description: 'Gibt den aktuellen Verbindungsstatus zum KNXnet/IP Secure Gateway zurück (Online, Gateway-IP, Tunnel-Kanal, Tunnel-Adresse, Heartbeat).',
  },
  async () => {
    try {
      const status = await apiFetch<any>('/knx/status');
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(status, null, 2),
          },
        ],
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Fehler beim Abrufen des Bus-Status: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Tool 2: Send KNX Telegram
registerTool(
  'knx_send_telegram',
  {
    description: 'Sendet ein KNX-Telegramm an den Bus (Schalten, Dimmen, Jalousie, Sollwert). Unterstützt Gruppenadressen (z. B. "4/0/15") oder semantische Namen (z. B. "Wohnzimmer Fenster LED").',
    inputSchema: {
      destination: z.string().describe('Gruppenadresse (z. B. "4/0/15" oder "1/0/0") oder Name der GA / des Lichts (z. B. "Wohnzimmer Fenster LED")'),
      value: z.string().describe('Wert zum Senden: "true"/"false" (oder "1"/"0") für Schalten, "0"-"100" für Dimmwert/Jalousie, oder Fließkommazahl für Temperatur/Sollwert'),
      dpt: z.string().optional().describe('Datapunkt-Typ (z. B. "1.001" für Switch, "5.001" für Prozentwert 0-100%, "9.001" für Temperatur/Float). Wenn weggelassen, wird der DPT automatisch ermittelt.'),
    },
  },
  async ({ destination, value, dpt }: { destination: string; value: string; dpt?: string }) => {
    try {
      let parsedValue: any = value;
      const lower = value.trim().toLowerCase();
      if (lower === 'true' || lower === 'on' || lower === 'ein') {
        parsedValue = true;
      } else if (lower === 'false' || lower === 'off' || lower === 'aus') {
        parsedValue = false;
      } else if (!isNaN(Number(value)) && value.trim() !== '') {
        parsedValue = Number(value);
      }

      let resolvedDpt = dpt;
      if (!resolvedDpt) {
        if (typeof parsedValue === 'boolean') {
          resolvedDpt = '1.001';
        } else if (typeof parsedValue === 'number') {
          resolvedDpt = parsedValue >= 0 && parsedValue <= 100 && Number.isInteger(parsedValue) ? '5.001' : '9.001';
        } else {
          resolvedDpt = '1.001';
        }
      }

      const res = await apiFetch<any>('/knx/send', {
        method: 'POST',
        body: JSON.stringify({
          destination,
          value: parsedValue,
          dpt: resolvedDpt,
        }),
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: `Telegramm erfolgreich gesendet an ${res.destination || destination}`,
                details: res,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Fehler beim Senden des Telegramms: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Tool 3: Read Group Address
registerTool(
  'knx_read_group_address',
  {
    description: 'Fragt eine Gruppenadresse auf dem KNX-Bus ab (GroupValueRead) oder ermittelt deren Metadaten im Projekt.',
    inputSchema: {
      destination: z.string().describe('Gruppenadresse (z. B. "0/0/1") oder Name der GA'),
    },
  },
  async ({ destination }: { destination: string }) => {
    try {
      const res = await apiFetch<any>('/knx/read', {
        method: 'POST',
        body: JSON.stringify({ destination }),
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Fehler beim Lesen der Gruppenadresse: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Tool 4: Project Summary
registerTool(
  'knx_get_project_summary',
  {
    description: 'Liefert eine vollständige Übersicht über das aktive KNX-Projekt: Gebäude, Räume, Anzahl der Geräte, Gruppenadressen und Gateway-Verbindung.',
  },
  async () => {
    try {
      const summary = await apiFetch<any>('/project/summary');
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(summary, null, 2),
          },
        ],
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Fehler beim Abrufen der Projektübersicht: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Tool 5: List Devices
registerTool(
  'knx_list_devices',
  {
    description: 'Listet alle KNX-Geräte im Projekt auf, inklusive physikalischer Adresse, Name, Hersteller, Modell, Raum und Dirty-Status.',
    inputSchema: {
      room_id: z.string().optional().describe('Optional: Filtern nach bestimmter Raum-ID'),
    },
  },
  async ({ room_id }: { room_id?: string }) => {
    try {
      const devices = await apiFetch<any[]>('/devices');
      const filtered = room_id ? devices.filter((d) => d.room_id === room_id) : devices;
      const simplified = filtered.map((d) => ({
        id: d.id,
        address: d.address,
        name: d.name,
        manufacturer: d.manufacturer,
        model: d.model || d.order_number,
        room_id: d.room_id,
        is_dirty: d.is_dirty,
        dirty_reasons: d.dirty_reasons,
        com_objects_count: (d.communication_objects || []).length,
        parameters_count: (d.parameters || []).length,
      }));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                total: simplified.length,
                devices: simplified,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Fehler beim Abrufen der Geräteliste: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Tool 6: List Group Addresses
registerTool(
  'knx_list_group_addresses',
  {
    description: 'Gibt alle im Projekt definierten Gruppenadressen zurück (z. B. Beleuchtung, Jalousien, Heizung).',
    inputSchema: {
      main_group: z.number().optional().describe('Optional: Hauptgruppe filtern (z. B. 0=Wetter/Zentral, 2=Jalousie, 4=Licht)'),
      search: z.string().optional().describe('Optional: Suchbegriff im Namen oder der Adresse'),
    },
  },
  async ({ main_group, search }: { main_group?: number; search?: string }) => {
    try {
      const gas = await apiFetch<any[]>('/group-addresses');
      let filtered = gas;

      if (main_group !== undefined) {
        filtered = filtered.filter((g) => {
          const parts = (g.address || '').split('/');
          return parts.length > 0 && parseInt(parts[0], 10) === main_group;
        });
      }

      if (search) {
        const query = search.toLowerCase();
        filtered = filtered.filter(
          (g) =>
            (g.name && g.name.toLowerCase().includes(query)) ||
            (g.address && g.address.toLowerCase().includes(query)) ||
            (g.description && g.description.toLowerCase().includes(query))
        );
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                total: filtered.length,
                group_addresses: filtered.map((g) => ({
                  address: g.address,
                  name: g.name,
                  dpt: g.dpt,
                  description: g.description,
                  is_custom: g.is_custom,
                })),
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Fehler beim Abrufen der Gruppenadressen: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Tool 7: Search Hardware Catalog
registerTool(
  'knx_search_catalog',
  {
    description: 'Durchsucht die SQLite-Gerätedatenbank (~/.konfix/catalog.db) nach KNX-Hardware (MDT, Siemens, ABB, Gira, Theben, etc.).',
    inputSchema: {
      query: z.string().describe('Suchbegriff (Hersteller, Bestellnummer oder Produktname, z. B. "MDT", "Schaltaktor", "AKK-0816.03")'),
      manufacturer: z.string().optional().describe('Optional: Hersteller einschränken'),
    },
  },
  async ({ query, manufacturer }: { query: string; manufacturer?: string }) => {
    try {
      let url = `/catalog/search?q=${encodeURIComponent(query)}`;
      if (manufacturer) {
        url += `&manufacturer=${encodeURIComponent(manufacturer)}`;
      }
      const results = await apiFetch<any[]>(url);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                query,
                total_found: results.length,
                products: results.slice(0, 20),
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Fehler bei der Katalogsuche: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Tool 8: Get Device Parameters
registerTool(
  'knx_get_device_parameters',
  {
    description: 'Ruft alle Parameter eines KNX-Geräts anhand seiner physikalischen Adresse ab (z. B. "1.1.10").',
    inputSchema: {
      device_address: z.string().describe('Physikalische Adresse des Geräts (z. B. "1.1.10")'),
    },
  },
  async ({ device_address }: { device_address: string }) => {
    try {
      const device = await apiFetch<any>(`/devices/by-address/${encodeURIComponent(device_address)}`);
      const paramsList = (device.parameters || []).map((p: any) => ({
        id: p.id,
        name: p.name,
        text: p.text,
        type: p.param_type,
        current_value: p.value,
        default_value: p.default_value,
        suffix: p.suffix,
        page: p.page,
        section: p.section,
      }));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                device_address,
                device_name: device.name,
                model: device.model || device.order_number,
                total_parameters: paramsList.length,
                parameters: paramsList,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Fehler beim Abrufen der Geräteparameter: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Tool 9: Set Device Parameter
registerTool(
  'knx_set_device_parameter',
  {
    description: 'Ändert einen Parameter eines KNX-Geräts im Projekt. Markiert das Gerät automatisch als "Geändert (Flash nötig)".',
    inputSchema: {
      device_address: z.string().describe('Physikalische Adresse des Geräts (z. B. "1.1.10")'),
      parameter_id: z.string().describe('ID oder Name des Parameters (z. B. "P-1" oder "staircase_time")'),
      value: z.string().describe('Der neue Parameterwert als String (z. B. "120", "1", "false")'),
    },
  },
  async ({
    device_address,
    parameter_id,
    value,
  }: {
    device_address: string;
    parameter_id: string;
    value: string;
  }) => {
    try {
      const device = await apiFetch<any>(`/devices/by-address/${encodeURIComponent(device_address)}`);
      const updateRes = await apiFetch<any>(`/devices/${device.id}/parameters`, {
        method: 'PUT',
        body: JSON.stringify({
          parameters: [{ id: parameter_id, value }],
        }),
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: `Parameter '${parameter_id}' von Gerät ${device_address} erfolgreich auf '${value}' gesetzt.`,
                device_id: device.id,
                device_name: updateRes.name,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Fehler beim Setzen des Parameters: ${err.message}` }],
        isError: true,
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Fatal error in KoNfiX MCP Server:', error);
  process.exit(1);
});
