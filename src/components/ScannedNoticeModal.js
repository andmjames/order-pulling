import React from 'react';

// Shown when a scanned order already has an "Items Scanned Successfully" comment.
// Go Back → return to scan a different packing list.
// Clear Old Scans and Start Over → dismiss and scan this order's items again.
export default function ScannedNoticeModal({ order, onGoBack, onStartOver }) {
  return (
    <div className="modal-overlay" onClick={onGoBack}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">This order has been scanned successfully</span>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6 }}>
            Sales Order <strong style={{ color: 'var(--text)' }}>{order.salesorder_number}</strong>
            {order.customer_name ? <> for <strong style={{ color: 'var(--text)' }}>{order.customer_name}</strong></> : null}
            {' '}already has an “Items Scanned Successfully” comment in Zoho.
          </p>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onGoBack}>Go Back</button>
          <button className="btn btn-primary" onClick={onStartOver}>Clear Old Scans and Start Over</button>
        </div>
      </div>
    </div>
  );
}
