// API helper for the Order Pulling app. The network call goes through a Netlify
// serverless function so Zoho OAuth credentials never reach the browser.

const API_BASE = '/.netlify/functions';

async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error || ''; } catch { detail = await res.text(); }
    throw new Error(detail || `API error ${res.status}`);
  }
  return res.json();
}

// Look up a sales order by its (scanned) number. Returns the order with
// line items enriched with units-per-case and a cases total.
export async function fetchSalesOrder(number) {
  return apiFetch(`/zoho-salesorder?number=${encodeURIComponent(number)}`);
}

// Add a comment to the sales order (used to record the scan result).
export async function postSalesOrderComment({ salesorderId, comment }) {
  return apiFetch('/zoho-salesorder-comment', {
    method: 'POST',
    body: JSON.stringify({ salesorder_id: salesorderId, comment }),
  });
}
