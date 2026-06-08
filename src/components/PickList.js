import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { parseScan, fmt, EPS } from '../lib/scan';
import { useToast } from './Toast';

const keyOf = (s) => String(s || '').trim().toUpperCase();

export default function PickList({ order, onDone }) {
  const lines = useMemo(() => order.line_items || [], [order]);

  const [scanned, setScanned] = useState({});       // { ITEMKEY: unitsScanned }
  const [lots, setLots] = useState({});             // { ITEMKEY: [lot, ...] }
  const [log, setLog] = useState([]);               // [{ item, qty, lot, ts }]
  const [blockedError, setBlockedError] = useState(''); // wrong item / too many → must Clear
  const [value, setValue] = useState('');
  const [showLog, setShowLog] = useState(false);

  const inputRef = useRef(null);
  const toast = useToast();

  const lineByKey = useMemo(() => {
    const m = new Map();
    lines.forEach((l) => m.set(keyOf(l.item_number), l));
    return m;
  }, [lines]);

  const focusScan = useCallback(() => {
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  useEffect(() => { focusScan(); }, [focusScan]);

  // ── Derived per-line numbers ──────────────────────────────────────────────
  const casesScannedFor = (l) => {
    const u = scanned[keyOf(l.item_number)] || 0;
    return l.unitsPerCase > 0 ? u / l.unitsPerCase : u;
  };
  const casesLeftFor = (l) => {
    const left = l.cases - casesScannedFor(l);
    return Math.abs(left) < 1e-4 ? 0 : left;
  };
  const rowState = (l) => {
    const left = casesLeftFor(l);
    if (left <= 1e-4) return 'done';
    if ((scanned[keyOf(l.item_number)] || 0) > 0) return 'partial';
    return '';
  };

  const allDone = lines.length > 0 && lines.every((l) => casesLeftFor(l) <= 1e-4);

  // ── Scan handling ─────────────────────────────────────────────────────────
  const handleScan = (raw) => {
    if (blockedError) return; // must Clear before scanning resumes
    const parsed = parseScan(raw);
    if (!parsed) return;
    if (!parsed.ok) {
      toast('Unreadable barcode — expected Item,Qty,Lot', 'error');
      return;
    }

    const k = keyOf(parsed.item);
    const line = lineByKey.get(k);

    // Wrong item — not on this order.
    if (!line) {
      const msg = `Wrong item scanned: "${parsed.item}" is not on this order. Press Clear and start over.`;
      setBlockedError(msg);
      toast(msg, 'error');
      return;
    }

    // Too many — scanning this case would exceed the ordered quantity.
    const prev = scanned[k] || 0;
    const next = prev + parsed.qty;
    if (next > line.quantity + EPS) {
      const msg = `Too many scanned for ${line.item_number}: ${fmt(next)} of ${fmt(line.quantity)} units. Press Clear and start over.`;
      setBlockedError(msg);
      toast(msg, 'error');
      return;
    }

    // Apply the scan: reduce cases-left and store the lot number.
    setScanned((s) => ({ ...s, [k]: next }));
    setLots((m) => ({ ...m, [k]: [...(m[k] || []), parsed.lot].filter(Boolean) }));
    setLog((l) => [{ item: line.item_number, qty: parsed.qty, lot: parsed.lot, ts: Date.now() }, ...l]);

    if (next > line.quantity - EPS) {
      toast(`${line.item_number} complete`, 'success');
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const v = value;
      setValue('');
      handleScan(v);
      focusScan();
    }
  };

  // ── Clear: wipe all scans for the order and restart scanning ──────────────
  const clearAll = () => {
    setScanned({});
    setLots({});
    setLog([]);
    setBlockedError('');
    setValue('');
    focusScan();
  };

  const doneScanning = () => {
    if (!allDone) {
      const ok = window.confirm('Some cases have not been scanned yet. Finish anyway and start a new order?');
      if (!ok) { focusScan(); return; }
    }
    onDone();
  };

  const totalCasesScanned = lines.reduce((sum, l) => sum + casesScannedFor(l), 0);

  return (
    <div className="pl-wrap" onClick={focusScan}>
      {/* ── Controls row ── */}
      <div className="pl-top">
        <div className="pl-meta">
          <div className="pl-meta-row"><span className="pl-meta-label">Customer</span><span className="pl-meta-val">{order.customer_name || '—'}</span></div>
          <div className="pl-meta-row"><span className="pl-meta-label">Customer PO</span><span className="pl-meta-val">{order.reference_number || '—'}</span></div>
          <div className="pl-meta-row">
            <span className="pl-meta-label">Sales Order</span>
            <span className="pl-meta-val">{order.salesorder_number}</span>
            {order.status && <span className={`badge ${order.status === 'draft' ? 'badge-gray' : 'badge-blue'}`} style={{ marginLeft: 8, textTransform: 'capitalize' }}>{order.status}</span>}
          </div>
        </div>

        <div className="pl-actions">
          <button className="btn" onClick={doneScanning}>Done Scanning</button>
          <div className="pl-totals">
            <div className="pl-total-row"><span className="pl-total-label">Total Cases</span><span className="pl-total-val">{fmt(order.totals?.cases)}</span></div>
            <div className="pl-total-row"><span className="pl-total-label">Total Pallets</span><span className="pl-total-val">{fmt(order.totals?.pallets)}</span></div>
            {order.delivery_method && <div className="pl-total-row pl-carrier">{order.delivery_method}</div>}
          </div>
          <button className="btn btn-danger pl-clear" onClick={clearAll}>Clear</button>
        </div>
      </div>

      {/* ── Status / scan bar ── */}
      {blockedError ? (
        <div className="pl-banner pl-banner-error">
          <span className="pl-banner-icon">✕</span>
          <span>{blockedError}</span>
          <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={clearAll}>Clear &amp; restart</button>
        </div>
      ) : allDone ? (
        <div className="pl-banner pl-banner-done">
          <span className="pl-banner-icon">✓</span>
          <span>Order fully scanned — all cases accounted for.</span>
        </div>
      ) : (
        <div className="pl-scanbar">
          <label className="pl-scan-label">Scan case barcode</label>
          <input
            ref={inputRef}
            className="pl-scan-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Item,Qty,Lot"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          <span className="pl-scan-hint">{fmt(totalCasesScanned)} of {fmt(order.totals?.cases)} cases scanned</span>
        </div>
      )}

      {/* ── Pick list table ── */}
      <div className="pl-table-wrap">
        <table className="pl-table">
          <thead>
            <tr>
              <th className="pl-num">Qty</th>
              <th>U/M</th>
              <th className="pl-num">Cases</th>
              <th>Item #</th>
              <th>Description</th>
              <th className="pl-num">Units/Case</th>
              <th className="pl-num">Cases left to Scan</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const state = rowState(l);
              const left = casesLeftFor(l);
              const itemLots = lots[keyOf(l.item_number)] || [];
              return (
                <tr key={l.item_id || i} className={`pl-row pl-row-${state || 'open'}`}>
                  <td className="pl-num">{fmt(l.quantity)}</td>
                  <td>{l.unit}</td>
                  <td className="pl-num">{fmt(l.cases)}</td>
                  <td className="pl-item">{l.item_number}</td>
                  <td className="pl-desc">
                    {l.description}
                    {itemLots.length > 0 && (
                      <div className="pl-lots">Lots: {itemLots.join(', ')}</div>
                    )}
                  </td>
                  <td className="pl-num pl-muted">{l.unitsPerCase ? fmt(l.unitsPerCase) : '—'}</td>
                  <td className={`pl-num pl-left ${left <= 1e-4 ? 'pl-left-done' : ''}`}>{fmt(left)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Scan log (captured lot numbers) ── */}
      <div className="pl-log">
        <button className="pl-log-toggle" onClick={(e) => { e.stopPropagation(); setShowLog((v) => !v); }}>
          {showLog ? '▾' : '▸'} Scan log ({log.length})
        </button>
        {showLog && (
          <div className="pl-log-body" onClick={(e) => e.stopPropagation()}>
            {log.length === 0 ? (
              <div className="pl-log-empty">No scans yet.</div>
            ) : (
              <table className="pl-log-table">
                <thead>
                  <tr><th>Item #</th><th className="pl-num">Qty (units)</th><th>Lot #</th><th>Time</th></tr>
                </thead>
                <tbody>
                  {log.map((s, i) => (
                    <tr key={i}>
                      <td className="pl-item">{s.item}</td>
                      <td className="pl-num">{fmt(s.qty)}</td>
                      <td>{s.lot || '—'}</td>
                      <td className="pl-muted">{new Date(s.ts).toLocaleTimeString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
