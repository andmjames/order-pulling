// Amazon orders are scanned with Amazon's own barcodes (FNSKU labels), not our
// standard "Item,Qty,Lot" barcodes. Each barcode maps to one of our item numbers
// and a fixed number of units per scan (e.g. one scan of X000NGE0DF = 36 rolls
// of PMI2451). There is no lot number in these barcodes.
//
// The list is small and fixed, so it lives here in code. To add an item, add a
// line:  'BARCODE': { item: 'OUR_ITEM_NUMBER', units: UNITS_PER_SCAN },

export const AMAZON_BARCODES = {
  X0014ME0Y1: { item: 'PMI3260', units: 24 },
  X000NGE0Z3: { item: 'PMI3451', units: 24 },
  X001ROT0W3: { item: 'PMI3451FA', units: 24 },
  X000NGE1D9: { item: 'PMI4451', units: 18 },
  X002RSB9YZ: { item: 'AMA3451', units: 1 },
  X002TV41XB: { item: 'AMA15380', units: 1 },
  X002TV8QT1: { item: 'AMA15382', units: 1 },
  X002TV3SMV: { item: 'AMA18380', units: 1 },
  X002TV8V7D: { item: 'AMA18382', units: 1 },
  X001ROX60F: { item: 'PMI4451FA', units: 18 },
  X001ROYR67: { item: 'PMI2260', units: 36 },
  X004R7PQIT: { item: 'PMI15607', units: 8 },
  X000NGE0DF: { item: 'PMI2451', units: 36 },
  X002SKKWWH: { item: 'PMID1', units: 1 },
  X001ROXSKD: { item: 'PMI2451FA', units: 36 },
  X000NGHRU3: { item: 'PMID2', units: 1 },
  X005F5N12F: { item: 'PMI3560', units: 24 },
  X005F5MYXH: { item: 'PMI2560', units: 36 },
  X005F5MZV3: { item: 'PMI4560', units: 18 },
};

// Compare codes with the look-alike characters folded together (O/0 and I/1),
// so a typo in the table above between those can't make a good label fail.
const fold = (s) => String(s || '').trim().toUpperCase().replace(/O/g, '0').replace(/I/g, '1');

const FOLDED = new Map(Object.entries(AMAZON_BARCODES).map(([code, v]) => [fold(code), v]));

// Parse a scan on an Amazon order into the common { ok, item, qty, lot, raw } shape.
// Anything that is not one of the Amazon barcodes above (including our own
// standard barcodes) is rejected.
export function parseAmazon(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const hit = FOLDED.get(fold(s));
  if (!hit) {
    const label = s.length > 40 ? `${s.slice(0, 40)}…` : s;
    return {
      ok: false,
      raw: s,
      reason: 'amazon_barcode',
      message: `Wrong item scanned: "${label}" is not an Amazon barcode. Amazon orders must be scanned with the Amazon barcode.`,
    };
  }
  return { ok: true, item: hit.item, qty: hit.units, lot: '', raw: s, qtyUnit: 'units' };
}
