import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { parseScan, fmt, EPS } from '../lib/scan';
import { postSalesOrderComment } from '../lib/zoho';
import { useToast } from './Toast';

const keyOf = (s) => String(s || '').trim().toUpperCase();

export default function PickList({ order, onDone }) {
  const lines = useMemo(() => order.line_items || [], [order]);

  const [scanned, setScanned] = useState({});       // { ITEMKEY: unitsScanned }
  const [lots, setLots] = useState({});             // { ITEMKEY: [lot, ...] }
  const [log, setLog] = useState([]);               // [{ item, qty, lot, ts }]
  const [rejects, setRejects] = useState([]);       // [{ item, qty, lot, reason }] wrong-item / too-many attempts
  const [blockedError, setBlockedError] = useState(''); // wrong item / too many → must Clear
  const [value, setValue] = useState('');
  const [showLog, setShowLog] = useState(false);
  const [posting, setPosting] = useState(false);

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
    if (!parsed) return; // empty input — ignore

    // A barcode that doesn't match a recognized item format (standard or Nazdar)
    // is treated as an incorrect item scanned: stop and force a restart.
    if (!parsed.ok) {
      const shown = String(parsed.raw || raw || '').trim();
      const label = shown.length > 40 ? `${shown.slice(0, 40)}…` : shown || '(unreadable)';
      const base = parsed.message || `Incorrect item scanned: "${label}" is not a recognized item barcode.`;
      const msg = `${base} Press Clear and start over.`;
      setBlockedError(msg);
      setRejects((r) => [...r, { item: label, qty: 0, lot: '', reason: 'bad_format' }]);
      toast(msg, 'error');
      return;
    }

    const k = keyOf(parsed.item);
    const line = lineByKey.get(k);

    // Wrong item — not on this order.
    if (!line) {
      const msg = `Wrong item scanned: "${parsed.item}" is not on this order. Press Clear and start over.`;
      setBlockedError(msg);
      setRejects((r) => [...r, { item: parsed.item, qty: parsed.qty, lot: parsed.lot, reason: 'wrong_item' }]);
      toast(msg, 'error');
      return;
    }

    // Quantity is normally in units. For the two Nazdar case-quantity items the
    // barcode QTY is a number of CASES, so convert to units via Units/Case.
    const addUnits =
      parsed.qtyUnit === 'cases' && line.unitsPerCase > 0
        ? parsed.qty * line.unitsPerCase
        : parsed.qty;

    // Too many — scanning this case would exceed the ordered quantity.
    const prev = scanned[k] || 0;
    const next = prev + addUnits;
    if (next > line.quantity + EPS) {
      const msg = `Too many scanned for ${line.item_number}: ${fmt(next)} of ${fmt(line.quantity)} units. Press Clear and start over.`;
      setBlockedError(msg);
      setRejects((r) => [...r, { item: line.item_number, qty: addUnits, lot: parsed.lot, reason: 'too_many' }]);
      toast(msg, 'error');
      return;
    }

    // Apply the scan: reduce cases-left and store the lot number.
    setScanned((s) => ({ ...s, [k]: next }));
    setLots((m) => ({ ...m, [k]: [...(m[k] || []), parsed.lot].filter(Boolean) }));
    setLog((l) => [{ item: line.item_number, qty: addUnits, lot: parsed.lot, ts: Date.now() }, ...l]);

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
    setRejects([]);
    setBlockedError('');
    setValue('');
    focusScan();
  };

  // Collapse a list of lot strings into "LOT (xN)" form.
  const aggregateLots = (arr) => {
    const counts = new Map();
    for (const raw of arr) {
      const lot = raw && String(raw).trim() ? String(raw).trim() : '(no lot #)';
      counts.set(lot, (counts.get(lot) || 0) + 1);
    }
    return [...counts.entries()].map(([lot, n]) => (n > 1 ? `${lot} (x${n})` : lot)).join(', ');
  };

  const isSuccess = allDone && rejects.length === 0;

  // Build the sales-order comment summarizing the scan result.
  const buildComment = () => {
    const out = [];
    out.push(isSuccess ? 'Items Scanned Successfully' : 'Items Scanned UNSUCCESSFULLY');
    out.push('');

    const scannedRows = lines
      .map((l) => {
        const arr = lots[keyOf(l.item_number)] || [];
        return arr.length ? `${l.item_number}: ${aggregateLots(arr)}` : null;
      })
      .filter(Boolean);

    if (scannedRows.length) out.push(...scannedRows);
    else out.push('(No items scanned)');

    if (!isSuccess) {
      const short = lines
        .map((l) => {
          const left = casesLeftFor(l);
          return left > 1e-4 ? `- Not scanned: ${l.item_number} — ${fmt(left)} of ${fmt(l.cases)} cases remaining` : null;
        })
        .filter(Boolean);
      const wrong = rejects.filter((r) => r.reason === 'wrong_item').map((r) => `- Wrong item: ${r.item} (not on order)`);
      const over = rejects.filter((r) => r.reason === 'too_many').map((r) => `- Over-scan: ${r.item} (exceeded ordered quantity)`);
      const bad = rejects.filter((r) => r.reason === 'bad_format').map((r) => `- Unrecognized barcode: ${r.item}`);

      const issues = [...short, ...wrong, ...over, ...bad];
      if (issues.length) {
        out.push('');
        out.push('Issues:');
        out.push(...issues);
      }
    }
    return out.join('\n');
  };

  const doneScanning = async () => {
    if (posting) return;
    if (!isSuccess) {
      const ok = window.confirm('Not all items scanned correctly. Post an "Items Scanned UNSUCCESSFULLY" comment to the sales order and finish?');
      if (!ok) { focusScan(); return; }
    }

    const comment = buildComment();
    setPosting(true);
    try {
      await postSalesOrderComment({ salesorderId: order.salesorder_id, comment });
      toast(isSuccess ? 'Comment added — scanned successfully' : 'Comment added — marked unsuccessful', isSuccess ? 'success' : 'error');
      onDone();
    } catch (e) {
      setPosting(false);
      const leave = window.confirm(`Could not add the comment to the sales order:\n${e.message}\n\nLeave without posting?`);
      if (leave) onDone();
      else focusScan();
    }
  };

  // Discard this order's scans and return to the scan gate to load a different
  // packing list. Does NOT post a comment to the sales order.
  const clearScansAndGoBack = () => {
    if (posting) return;
    const hasProgress = log.length > 0 || rejects.length > 0 || value.trim();
    if (hasProgress) {
      const ok = window.confirm('Discard the scans for this order and go back to scan a different packing list? No comment will be posted.');
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
          <div className="pl-action-btns">
            <button className="btn btn-ghost" onClick={clearScansAndGoBack} disabled={posting}>Clear Scans &amp; Go Back</button>
            <button className="btn" onClick={doneScanning} disabled={posting}>
              {posting ? <><span className="spinner" /> Posting…</> : 'Done Scanning'}
            </button>
          </div>
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
              <th className="pl-num">Cases on Hand</th>
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
                  <td className="pl-item">
                    {l.item_number}
                    {l.canFlip && (
                      <div className="pl-flip-note">This item can be flipped from PMI Stock</div>
                    )}
                  </td>
                  <td className="pl-desc">
                    {l.description}
                    {itemLots.length > 0 && (
                      <div className="pl-lots">Lots: {itemLots.join(', ')}</div>
                    )}
                  </td>
                  <td className="pl-num pl-onhand">{l.casesOnHand == null ? '—' : fmt(l.casesOnHand)}</td>
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
