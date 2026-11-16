import React, { useState, useRef, useEffect } from 'react';
import { fetchSalesOrder } from '../lib/zoho';
import { useToast } from './Toast';

export default function ScanGate({ onLoaded }) {
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  const toast = useToast();

  useEffect(() => { inputRef.current?.focus(); }, []);

  const lookup = async (raw) => {
    const num = String(raw || '').trim();
    if (!num || loading) return;
    setLoading(true);
    setError('');
    try {
      const order = await fetchSalesOrder(num);
      if (!order || !order.salesorder_number) throw new Error('Sales order not found');
      onLoaded(order);
    } catch (e) {
      const msg = e.message || 'Lookup failed';
      setError(msg);
      toast(msg, 'error');
      setValue('');
      setTimeout(() => inputRef.current?.focus(), 0);
    } finally {
      setLoading(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); lookup(value); }
  };

  return (
    <div className="scan-gate">
      <div className="scan-card">
        <div className="scan-card-eyebrow">Order Pulling</div>
        <h1 className="scan-card-title">Scan Packing List</h1>
        <p className="scan-card-sub">
          Scan or type the invoice number to load the order from Zoho Inventory.
        </p>

        <div className="scan-gate-input-row">
          <input
            ref={inputRef}
            className="scan-gate-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Sales Order #"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            disabled={loading}
          />
          <button
            className="btn btn-primary scan-gate-btn"
            onClick={() => lookup(value)}
            disabled={loading || !value.trim()}
          >
            {loading ? <><span className="spinner" /> Loading…</> : 'Load order'}
          </button>
        </div>

        {error && <div className="scan-gate-error">{error}</div>}

        <div className="scan-gate-hint">
          Click into the box and scan — the order loads automatically on the scanner's Enter.
        </div>
      </div>
    </div>
  );
}
