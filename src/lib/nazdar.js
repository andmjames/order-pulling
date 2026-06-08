// Nazdar Company case barcodes use a different format from the standard
// "ItemNumber,Quantity,LotNumber". Example:
//
//   ]C1ITNOIMS84513|BANO406086|QTY24000
//
//   • Item   — the segment after "ITNO" (the Nazdar alias, e.g. "IMS84513"),
//              mapped to our item number via NAZDAR_ALIAS_TO_ITEM below.
//   • Lot    — the digits after "BANO" (e.g. "406086").
//   • Qty    — the number after "QTY" divided by 1000 (e.g. 24000 → 24 units).
//
// The alias list is small and fixed, so it lives here in code (no Supabase).
// Generated from Aliases.csv — keyed by the part after "ITNO" (uppercased).

export const NAZDAR_ALIAS_TO_ITEM = {
  "IMS4212X110": "NAZ2421",
  "IMS4213X110": "NAZ3421",
  "IMS84512": "NAZ2451",
  "IMS84513": "NAZ3451",
  "IMS84513FA": "NAZ3451FA",
  "IMS84513QR": "NAZ3260",
  "IMS84514CS": "NAZ4451",
  "IMS84514FA": "NAZ4451FA",
  "IMS9203X60YD": "NAZ3920",
  "NAZ2820": "NAZ2820",
  "NAZ4820": "NAZ4820",
  "PMI15380": "NAZ15380",
  "PMI15382": "NAZ15382",
  "PMI15607": "PMI15607",
  "PMI16918": "NAZ16918",
  "PMI18380": "NAZ18380",
  "PMI18382": "NAZ18382",
  "PMI20380": "PMI20380",
  "PMI22601CE": "PMI2260",
  "PMI2451FAHC HANDS ON": "PMI2451FAHC",
  "PMI3212X110": "PMI2321",
  "PMI3213X110CS": "PMI3321",
  "PMI32601CE": "PMI3260",
  "PMI3451HC": "PMI3451HC",
  "PMI3560": "PMI3560",
  "PMI42601CE": "PMI4260",
  "PMI4380": "PMI4380",
  "PMI4451HC": "PMI4451HC",
  "PMI451FA2X60": "PMI2451FA",
  "PMI451FA3X60CS": "PMI3451FA",
  "PMI451FA4X60": "PMI4451FA",
  "PMID2": "PMID2",
  "PMI3260 SKID": "PMI3260SKID",
};

// A Nazdar barcode is identified by the "ITNO" token (every alias contains it).
export function isNazdarBarcode(s) {
  return /ITNO/i.test(String(s || ''));
}

// Parse a Nazdar barcode into the common { ok, item, qty, lot, raw } shape.
export function parseNazdar(raw) {
  const s = String(raw || '').trim();
  // Segments are separated by "|" (or the GS control char some scanners emit).
  const segs = s.split(/[|\u001d]/).map((x) => x.trim()).filter(Boolean);

  const itemSeg = segs.find((x) => /ITNO/i.test(x));
  const banoSeg = segs.find((x) => /BANO/i.test(x));
  const qtySeg = segs.find((x) => /QTY/i.test(x));

  // Core = everything after the first "ITNO", uppercased (matches the map keys).
  const core = itemSeg ? itemSeg.replace(/^.*?ITNO/i, '').trim().toUpperCase() : '';
  const item = core ? NAZDAR_ALIAS_TO_ITEM[core] : undefined;

  const lot = banoSeg ? banoSeg.replace(/^.*?BANO/i, '').trim() : '';

  const qtyDigits = qtySeg ? qtySeg.replace(/^.*?QTY/i, '').replace(/[^0-9.\-]/g, '') : '';
  const qty = qtyDigits ? Number(qtyDigits) / 1000 : NaN;

  if (!item) {
    return {
      ok: false,
      raw: s,
      reason: 'nazdar_alias',
      message: `Unrecognized Nazdar item barcode${core ? ` (${core})` : ''} — not in the alias list.`,
    };
  }
  if (!isFinite(qty) || qty <= 0) {
    return { ok: false, raw: s, reason: 'format', message: 'Unreadable Nazdar barcode — missing QTY.' };
  }
  return { ok: true, item, qty, lot, raw: s };
}
