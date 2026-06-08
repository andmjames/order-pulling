// Pure helpers for the scanning logic — no network, easy to read/adjust.

// Floating-point tolerance for "fully scanned" / "too many" comparisons.
export const EPS = 1e-6;

// Parse a scanned case barcode in the format:  ItemNumber,Quantity(units),LotNumber
// The lot number is allowed to contain commas (anything after the 2nd comma is
// treated as the lot), so an odd lot like "A,12" still reads correctly.
export function parseScan(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;

  const parts = s.split(',');
  if (parts.length < 2) return { ok: false, raw: s, reason: 'format' };

  const item = parts[0].trim();
  const qty = Number(String(parts[1]).replace(/[^0-9.\-]/g, ''));
  const lot = parts.slice(2).join(',').trim();

  if (!item || !isFinite(qty) || qty <= 0) return { ok: false, raw: s, reason: 'format' };
  return { ok: true, item, qty, lot, raw: s };
}

// Format a number for display (trims trailing zeros, up to 3 decimals).
export function fmt(n) {
  const v = Math.round((Number(n) || 0) * 1000) / 1000;
  return v.toLocaleString('en-US', { maximumFractionDigits: 3 });
}
