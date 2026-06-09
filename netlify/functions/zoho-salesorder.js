// Look up a Sales Order in Zoho Inventory by its number (from a scanned barcode)
// and return its line items enriched with units-per-case so the UI can show
// "Cases" and "Cases left to Scan". Works for draft, open, and closed orders.
const { zohoGet, headers, checkEnv } = require('./zoho-utils');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Zoho GET with retry + exponential backoff for transient auth/rate/timeout hiccups.
async function zohoGetRetry(path, attempts = 3) {
  let lastErr;
  for (let a = 0; a < attempts; a++) {
    try {
      return await zohoGet(path);
    } catch (e) {
      lastErr = e;
      if (a < attempts - 1) await sleep(300 * Math.pow(2, a) + Math.random() * 150);
    }
  }
  throw lastErr;
}

const norm = (s) => String(s || '').trim().toLowerCase();
const num = (v, d = 0) => {
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? d : n;
};

// Find the sales order whose number EXACTLY matches the entered/scanned value.
// Partial entries (e.g. "36") must NOT resolve to a longer number ("36611").
async function findSalesOrder(raw) {
  const target = norm(raw);
  if (!target) return null;

  const tryList = async (path) => {
    try {
      const d = await zohoGetRetry(path);
      return d.salesorders || [];
    } catch {
      return [];
    }
  };

  // The salesorder_number filter can return near-matches (Zoho does a contains-style
  // search), and search_text is broader still — so in BOTH cases we only accept a
  // result whose salesorder_number is exactly equal to what was entered.
  const exact = (list) => list.find((so) => norm(so.salesorder_number) === target) || null;

  let hit = exact(await tryList(`/salesorders?salesorder_number=${encodeURIComponent(raw)}`));
  if (hit) return hit;

  hit = exact(await tryList(`/salesorders?search_text=${encodeURIComponent(raw)}`));
  return hit || null;
}

// Read units/weight/cases-per-case from an item's custom fields (labels vary).
function customFields(item) {
  const cf = (...labels) => {
    for (const label of labels) {
      const f = item.custom_fields?.find((x) => x.label === label);
      if (f && f.value !== undefined && f.value !== '') return f.value;
    }
    return '';
  };
  return {
    unitsPerCase: cf('Units per Case', 'Units per Carton', 'Units/Case', 'Units/Carton'),
    weightPerCase: cf('Weight per Case (LBS)', 'Weight Per Case (LBS)', 'Weight per Case', 'Weight Per Carton (LBS)'),
    casesPerPallet: cf('Cases per Pallet', 'Cartons per Pallet', 'Cases/Pallet', 'Cartons/Pallet'),
    canFlip: canFlipFromPmiStock(item),
  };
}

// Treat common "yes"/checkbox representations as true.
function isYes(v) {
  if (v === true) return true;
  return ['yes', 'true', '1', 'y', 'on'].includes(String(v == null ? '' : v).trim().toLowerCase());
}

// Robustly detect the "Can Be Flipped From PMI Stock" custom field. Zoho can
// expose custom fields under custom_fields[] (label/value/value_formatted) or in
// custom_field_hash{} (keys like cf_can_be_flipped_from_pmi_stock), and the value
// may be a string ("Yes") or a boolean. Match any field whose label/key mentions
// both "flip" and "pmi".
function canFlipFromPmiStock(item) {
  const looksLikeFlip = (s) => {
    const t = String(s || '').toLowerCase();
    return t.includes('flip') && t.includes('pmi');
  };

  const fields = Array.isArray(item.custom_fields) ? item.custom_fields : [];
  for (const f of fields) {
    if (looksLikeFlip(f.label) || looksLikeFlip(f.placeholder) || looksLikeFlip(f.api_name)) {
      if (isYes(f.value) || isYes(f.value_formatted)) return true;
    }
  }

  const hash = item.custom_field_hash && typeof item.custom_field_hash === 'object' ? item.custom_field_hash : {};
  for (const [k, v] of Object.entries(hash)) {
    if (looksLikeFlip(k) && isYes(v)) return true;
  }

  return false;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    checkEnv();
    const number = (event.queryStringParameters?.number || '').trim();
    if (!number) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing sales order number' }) };
    }

    const found = await findSalesOrder(number);
    if (!found) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Order not found. Scan again' }) };
    }

    // Line items live on the full detail record.
    const detail = await zohoGetRetry(`/salesorders/${found.salesorder_id}`);
    const so = detail.salesorder || found;
    const rawLines = so.line_items || [];

    // Enrich each distinct item with its per-case fields.
    const ids = [...new Set(rawLines.map((li) => li.item_id).filter(Boolean))];
    const itemMap = new Map();
    for (let i = 0; i < ids.length; i += 5) {
      const batch = ids.slice(i, i + 5);
      const settled = await Promise.allSettled(batch.map((id) => zohoGetRetry(`/items/${id}`)));
      settled.forEach((r, j) => {
        if (r.status === 'fulfilled' && r.value?.item) itemMap.set(batch[j], r.value.item);
      });
    }

    // Debug aid: dump each item's custom-field labels/values so the exact
    // "Can Be Flipped From PMI Stock" label/value can be confirmed in Netlify logs.
    try {
      const dump = [...itemMap.values()].map((it) => ({
        sku: it.sku,
        custom_fields: (it.custom_fields || []).map((f) => ({ label: f.label, value: f.value, value_formatted: f.value_formatted })),
        custom_field_hash_keys: Object.keys(it.custom_field_hash || {}),
        canFlip: canFlipFromPmiStock(it),
      }));
      console.log('[flip-debug]', JSON.stringify(dump));
    } catch (e) { /* ignore */ }

    let totalCases = 0;
    let palletFraction = 0;

    // Only inventory (stock) items are scannable. Drop services / fees like
    // "Credit Card Fee", shipping charges, etc. A line is kept when its item is
    // not a service and its item_type is "inventory" (or unknown — e.g. when the
    // item detail couldn't be fetched, we keep it rather than risk dropping stock).
    const isScannableInventory = (li) => {
      const item = itemMap.get(li.item_id) || {};
      const productType = String(item.product_type || li.product_type || '').toLowerCase();
      if (productType === 'service') return false;
      const itemType = String(item.item_type || li.item_type || '').toLowerCase();
      if (!itemType) return true;
      return itemType === 'inventory';
    };

    const line_items = rawLines.filter(isScannableInventory).map((li) => {
      const item = itemMap.get(li.item_id) || {};
      const extra = customFields(item);
      const unitsPerCase = num(extra.unitsPerCase, 0);
      const casesPerPallet = num(extra.casesPerPallet, 0);
      const qty = num(li.quantity, 0);
      const cases = unitsPerCase > 0 ? qty / unitsPerCase : qty;

      totalCases += cases;
      if (casesPerPallet > 0) palletFraction += cases / casesPerPallet;

      // Live "on hand" stock (units) from Zoho → whole cases (rounded down).
      const onHandRaw =
        item.stock_on_hand != null && item.stock_on_hand !== ''
          ? Number(item.stock_on_hand)
          : null;
      const casesOnHand =
        onHandRaw == null
          ? null
          : Math.floor(unitsPerCase > 0 ? onHandRaw / unitsPerCase : onHandRaw);

      return {
        item_id: li.item_id,
        item_number: item.sku || li.sku || li.name || '',
        name: li.name || item.name || '',
        description: li.description || item.sales_description || item.description || '',
        unit: li.unit || item.unit || '',
        quantity: Math.round(qty * 100) / 100,
        unitsPerCase,
        weightPerCase: num(extra.weightPerCase, 0),
        casesPerPallet,
        cases: Math.round(cases * 1000) / 1000,
        casesOnHand,
        canFlip: !!extra.canFlip,
      };
    });

    const pallets = palletFraction > 0 ? Math.ceil(palletFraction) : totalCases > 0 ? 1 : 0;

    // Has this order already been scanned successfully? Look for a prior
    // "Items Scanned Successfully" comment (best-effort — don't fail the load).
    let scanned_successfully = false;
    try {
      const cdata = await zohoGetRetry(`/salesorders/${found.salesorder_id}/comments`);
      const comments = cdata.comments || [];
      scanned_successfully = comments.some((c) =>
        String(c.description || '').toLowerCase().includes('items scanned successfully')
      );
    } catch (e) {
      console.warn('zoho-salesorder: could not read comments:', e.message);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        salesorder_id: so.salesorder_id,
        salesorder_number: so.salesorder_number,
        reference_number: so.reference_number || '',
        customer_name: so.customer_name || '',
        status: so.status || '',
        date: so.date || '',
        delivery_method: so.delivery_method || so.shipping_method || '',
        line_items,
        totals: { cases: Math.round(totalCases * 1000) / 1000, pallets },
        scanned_successfully,
      }),
    };
  } catch (err) {
    console.error('zoho-salesorder error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
