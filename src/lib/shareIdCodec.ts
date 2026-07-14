/**
 * Compact share path IDs: UUID (36 chars) → base64url of 16 raw bytes (22 chars).
 * Keeps /o/:kind/:id URLs shorter without a link database. Server must use the same rules (see api/shareIdCodec.js).
 */

const UUID_WITH_HYPHENS =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hex32ToUuid(hex: string): string {
  const h = hex.toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** 16 bytes → base64url (no padding). */
export function compactIdFromUuid(uuid: string): string {
  const u = String(uuid ?? '').trim();
  if (!u) return '';
  const hex = u.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) return encodeURIComponent(u);
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 32; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  let bin = '';
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Path segment or stored id → canonical UUID string for API/routes; '' if invalid compact. */
export function normalizeShareResourceId(raw: string | null | undefined): string {
  if (raw == null) return '';
  let s = String(raw).trim();
  if (!s) return '';
  try {
    s = decodeURIComponent(s);
  } catch {
    /* keep s */
  }
  s = s.trim();
  if (!s) return '';

  if (UUID_WITH_HYPHENS.test(s)) return s.toLowerCase();
  if (/^[0-9a-f]{32}$/i.test(s)) return hex32ToUuid(s);

  if (!/^[A-Za-z0-9_-]+$/.test(s) || s.length < 20) {
    return s.replace(/[^A-Za-z0-9_-]/g, '');
  }

  try {
    const padLen = (4 - (s.length % 4)) % 4;
    const pad = padLen ? '='.repeat(padLen) : '';
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
    const bin = atob(b64);
    if (bin.length !== 16) return '';
    const bytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) bytes[i] = bin.charCodeAt(i);
    let hex = '';
    bytes.forEach((b) => {
      hex += b.toString(16).padStart(2, '0');
    });
    const uuid = hex32ToUuid(hex);
    if (!UUID_WITH_HYPHENS.test(uuid)) return '';
    if (compactIdFromUuid(uuid) !== s) return '';
    return uuid;
  } catch {
    return '';
  }
}
