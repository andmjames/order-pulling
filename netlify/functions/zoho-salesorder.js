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
const digits = (s) => String(s || '').replace(/[^0-9]/g, '');
const num = (v, d = 0) => {
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? d : n;
};

// Find the sales order header matching the scanned value. We try the exact
// salesorder_number filter first, then a broad search_text, then reference_number.
async function findSalesOrder(raw) {
  const target = norm(raw);
  const targetDigits = digits(raw);

  const tryList = async (path) => {
    try {
      const d = await zohoGetRetry(path);
      return d.salesorders || [];
    } catch {
      return [];
    }
  };

  // 1) Exact salesorder_number filter.
  let list = await tryList(`/salesorders?salesorder_number=${encodeURIComponent(raw)}`);
  let hit = list.find((so) => norm(so.salesorder_number) === target);
  if (hit) return hit;

  // 2) Broad search (covers SO number with/without prefix, reference #, etc.).
  list = await tryList(`/salesorders?search_text=${encodeURIComponent(raw)}`);
  hit =
    list.find((so) => norm(so.salesorder_number) === target) ||
    list.find((so) => norm(so.reference_number) === target) ||
    (targetDigits && list.find((so) => digits(so.salesorder_number) === targetDigits)) ||
    list[0];
  if (hit) return hit;

  // 3) Reference number (customer PO) filter as a last resort.
  list = await tryList(`/salesorders?reference_number=${encodeURIComponent(raw)}`);
  hit = list.find((so) => norm(so.reference_number) === target) || list[0];
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
  };
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
      return { statusCode: 404, headers, body: JSON.stringify({ error: `No sales order found for "${number}"` }) };
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

    let totalCases = 0;
    let palletFraction = 0;

    const line_items = rawLines.map((li) => {
      const item = itemMap.get(li.item_id) || {};
      const extra = customFields(item);
      const unitsPerCase = num(extra.unitsPerCase, 0);
      const casesPerPallet = num(extra.casesPerPallet, 0);
      const qty = num(li.quantity, 0);
      const cases = unitsPerCase > 0 ? qty / unitsPerCase : qty;

      totalCases += cases;
      if (casesPerPallet > 0) palletFraction += cases / casesPerPallet;

      // Live "on hand" stock (units) from Zoho → converted to cases for display.
      const onHandRaw =
        item.stock_on_hand != null && item.stock_on_hand !== ''
          ? Number(item.stock_on_hand)
          : null;
      const casesOnHand =
        onHandRaw == null
          ? null
          : Math.round((unitsPerCase > 0 ? onHandRaw / unitsPerCase : onHandRaw) * 1000) / 1000;

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
