// Add a comment to a Zoho Inventory Sales Order. Used by the Order Pulling app
// to record the scan result (success/unsuccessful + scanned lots) when the user
// taps "Done Scanning". Posting a comment needs the salesorders write scope
// (ZohoInventory.salesorders.CREATE) — the default scope in zoho-utils includes it.
const { zohoPost, headers, checkEnv } = require('./zoho-utils');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    checkEnv();
    const { salesorder_id, comment } = JSON.parse(event.body || '{}');

    if (!salesorder_id) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'salesorder_id required' }) };
    }
    if (!comment || !String(comment).trim()) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'comment required' }) };
    }

    const result = await zohoPost(`/salesorders/${salesorder_id}/comments`, {
      description: String(comment),
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, comment_id: result?.comment?.comment_id || null }),
    };
  } catch (err) {
    console.error('zoho-salesorder-comment error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
