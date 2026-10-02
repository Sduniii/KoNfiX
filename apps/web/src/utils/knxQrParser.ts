import jsQR from 'jsqr'

export interface KnxCertificateQrResult {
  serialNumber?: string
  fdsk?: string
  rawText: string
  valid: boolean
}

/**
 * Normalizes a 12-char hex serial into standard MAC/KNX colon format (e.g. 00:83:7B:40:02:85)
 */
export function formatSerialNumber(raw: string): string {
  const clean = raw.replace(/[^0-9a-fA-F]/g, '').toUpperCase()
  if (clean.length === 12) {
    return clean.match(/.{2}/g)?.join(':') || raw
  }
  return raw
}

/**
 * Normalizes FDSK to 32 uppercase hex characters
 */
export function formatFdsk(raw: string): string {
  return raw.replace(/[^0-9a-fA-F]/g, '').toUpperCase()
}

/**
 * Parses official KNX QR-Code strings or custom certificate formats
 * Official standard: KNX:S:<SerialNumber>;F:<FDSK>[;P:<PartNumber>...]
 */
export function parseKnxCertificateQr(rawText: string): KnxCertificateQrResult {
  const text = rawText.trim()
  if (!text) {
    return { rawText, valid: false }
  }

  let serialNumber: string | undefined
  let fdsk: string | undefined

  // 1. Official KNX scheme: KNX:S:...;F:...
  if (text.toUpperCase().startsWith('KNX:')) {
    const parts = text.substring(4).split(';')
    for (const part of parts) {
      const idx = part.indexOf(':')
      if (idx !== -1) {
        const key = part.substring(0, idx).trim().toUpperCase()
        const val = part.substring(idx + 1).trim()
        if (key === 'S') {
          serialNumber = formatSerialNumber(val)
        } else if (key === 'F') {
          fdsk = formatFdsk(val)
        }
      }
    }
  }

  // 2. Short key-value scheme: S:...;F:... (without KNX: prefix)
  if (!serialNumber && !fdsk) {
    const sMatch = text.match(/(?:^|;)S:([0-9a-fA-F:]{12,17})/i)
    const fMatch = text.match(/(?:^|;)F:([0-9a-fA-F-]{32,45})/i)
    if (sMatch) {
      serialNumber = formatSerialNumber(sMatch[1])
    }
    if (fMatch) {
      fdsk = formatFdsk(fMatch[1])
    }
  }

  // 3. Delimited raw string fallback: e.g. <serial>-<fdsk>
  if (!serialNumber && !fdsk) {
    const parts = text.split(/[-–_]/)
    if (parts.length === 2) {
      const p0 = parts[0].replace(/[^0-9a-fA-F]/g, '')
      const p1 = parts[1].replace(/[^0-9a-fA-F]/g, '')
      if (p0.length === 12 && p1.length === 32) {
        serialNumber = formatSerialNumber(p0)
        fdsk = p1.toUpperCase()
      }
    }
  }

  // 4. Raw FDSK or Serial fallback
  if (!fdsk) {
    const hexOnly = text.replace(/[^0-9a-fA-F]/g, '')
    if (hexOnly.length === 32) {
      fdsk = hexOnly.toUpperCase()
    } else if (hexOnly.length === 44 && (hexOnly.startsWith('00') || hexOnly.startsWith('01'))) {
      serialNumber = formatSerialNumber(hexOnly.slice(0, 12))
      fdsk = hexOnly.slice(12).toUpperCase()
    }
  }

  const valid = (fdsk !== undefined && fdsk.length === 32) || (serialNumber !== undefined && serialNumber.length >= 12)

  return {
    serialNumber,
    fdsk,
    rawText,
    valid,
  }
}

/**
 * Decodes a QR code from an HTML Video element or Canvas context using BarcodeDetector or jsQR
 */
export async function decodeQrFromImageData(
  imageData: ImageData
): Promise<string | null> {
  // Fallback / standard decoder: jsQR
  const code = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: 'dontInvert',
  })
  if (code && code.data) {
    return code.data
  }

  // Second pass with inverted colors for high-contrast inverted stickers
  const inverted = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: 'onlyInvert',
  })
  if (inverted && inverted.data) {
    return inverted.data
  }

  return null
}
