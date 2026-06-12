import { useEffect, useState } from 'react';
import * as api from '../lib/inventory-api';
import type { Product, InboundRecord, OutboundRecord, Customer, StockAlert, DistributorCandidate } from '../lib/inventory-api';

type Tab = 'stock' | 'inbound' | 'outbound' | 'customers' | 'alerts';

export default function InventoryManager() {
  const [tab, setTab] = useState<Tab>('stock');
  const [products, setProducts] = useState<Product[]>([]);
  const [inbounds, setInbounds] = useState<InboundRecord[]>([]);
  const [outbounds, setOutbounds] = useState<OutboundRecord[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [alerts, setAlerts] = useState<StockAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [scanMode, setScanMode] = useState<'inbound' | 'outbound' | null>(null);
  const [scanSku, setScanSku] = useState('');
  const [scanQty, setScanQty] = useState(1);
  const [scanCustomer, setScanCustomer] = useState('');
  const [scanNote, setScanNote] = useState('');
  const [scanBarcode, setScanBarcode] = useState('');

  const loadAll = async () => {
    setLoading(true);
    try {
      const [p, ib, ob, c, a] = await Promise.all([
        api.getStock(), api.getInbounds(), api.getOutbounds(),
        api.getCustomers(), api.getProductAlerts(),
      ]);
      setProducts(p); setInbounds(ib); setOutbounds(ob);
      setCustomers(c); setAlerts(a);
    } catch (e: any) { setMessage('Load failed: ' + e.message); }
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, []);

  const TABS: { key: Tab; label: string; color: string }[] = [
    { key: 'stock', label: `Stock (${products.length})`, color: '#2563eb' },
    { key: 'inbound', label: 'Inbound', color: '#22c55e' },
    { key: 'outbound', label: 'Outbound', color: '#f59e0b' },
    { key: 'customers', label: `Customers (${customers.length})`, color: '#a855f7' },
    { key: 'alerts', label: `Alerts (${alerts.length})`, color: '#ef4444' },
  ];

  const lowStock = products.filter(p => p.status === 'low_stock' || p.status === 'out_of_stock');
  const totalStock = products.reduce((s, p) => s + (p.current_stock || 0), 0);

  return (
    <div style={{ padding: 16, color: '#fafafa', maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Inventory</h2>
          <p style={{ fontSize: 12, color: '#71717a', marginTop: 2 }}>
            {products.length} products · {totalStock} units · {lowStock.length} low stock
          </p>
        </div>
        <button onClick={loadAll} disabled={loading}
          style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #27272a', background: '#18181b', color: '#a1a1aa', fontSize: 12, cursor: 'pointer' }}>
          {loading ? 'Loading...' : '⟳ Refresh'}
        </button>
      </div>

      {message && (
        <div style={{ background: message.includes('failed') ? '#7f1d1d' : '#14532d', padding: '8px 12px', borderRadius: 8, marginBottom: 12, fontSize: 13, color: message.includes('failed') ? '#fca5a5' : '#86efac' }}>
          {message}
          <button onClick={() => setMessage('')} style={{ marginLeft: 12, background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}>X</button>
        </div>
      )}

      {/* Quick Scan */}
      {!scanMode && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button onClick={() => { setScanMode('inbound'); setScanSku(''); setScanQty(1); setScanCustomer(''); setScanNote(''); }}
            style={{ flex: 1, padding: '14px 0', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, #22c55e, #16a34a)', color: 'white', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
            📥 Scan Inbound
          </button>
          <button onClick={() => { setScanMode('outbound'); setScanSku(''); setScanQty(1); setScanCustomer(''); setScanNote(''); }}
            style={{ flex: 1, padding: '14px 0', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, #f59e0b, #d97706)', color: 'white', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
            📤 Scan Outbound
          </button>
        </div>
      )}

      {/* Scan Panel */}
      {scanMode && (
        <div style={{ background: '#18181b', borderRadius: 12, padding: 16, marginBottom: 12, border: '1px solid #27272a' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h4 style={{ fontSize: 14, fontWeight: 600, margin: 0, color: scanMode === 'inbound' ? '#22c55e' : '#f59e0b' }}>
              {scanMode === 'inbound' ? '📥 Scan Inbound' : '📤 Scan Outbound'}
            </h4>
            <button onClick={() => setScanMode(null)} style={{ background: 'none', border: 'none', color: '#71717a', cursor: 'pointer', fontSize: 14 }}>X</button>
          </div>

          {/* Barcode / SKU input — also catches physical scanner input */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 11, color: '#71717a', display: 'block', marginBottom: 2 }}>SCAN BARCODE or TYPE SKU</label>
              <input value={scanBarcode || scanSku} onChange={e => {
                const val = e.target.value;
                setScanBarcode(val);
                // Auto-match product by barcode or SKU
                const match = products.find(p => p.sku === val || (p as any).barcode === val);
                if (match) setScanSku(match.sku);
                else setScanSku(val); // fallback: treat as SKU
              }} placeholder="Scan barcode or type SKU..."
                style={{ width: '100%', padding: '10px 12px', borderRadius: 6, border: '2px solid #22c55e', background: '#0c0c0e', color: '#fafafa', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#71717a', display: 'block', marginBottom: 2 }}>SKU (matched)</label>
              <input list="scan-sku-list" value={scanSku} onChange={e => setScanSku(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 6, border: '1px solid #27272a', background: '#0c0c0e', color: '#fafafa', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
              <datalist id="scan-sku-list">{products.map(p => <option key={p.sku} value={p.sku} label={`${p.name} (stock: ${p.current_stock})`} />)}</datalist>
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#71717a', display: 'block', marginBottom: 2 }}>QUANTITY</label>
              <input type="number" value={scanQty || ''} onChange={e => setScanQty(Math.max(1, Number(e.target.value)))}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 6, border: '1px solid #27272a', background: '#0c0c0e', color: '#fafafa', fontSize: 14, fontWeight: 700, outline: 'none', boxSizing: 'border-box' }} />
            </div>
            {scanMode === 'outbound' && (
              <div>
                <label style={{ fontSize: 11, color: '#71717a', display: 'block', marginBottom: 2 }}>CUSTOMER (B2B) or B2C</label>
                <input list="scan-cust-list" value={scanCustomer} onChange={e => setScanCustomer(e.target.value)} placeholder="B2C or customer name"
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 6, border: '1px solid #27272a', background: '#0c0c0e', color: '#fafafa', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
                <datalist id="scan-cust-list">
                  <option value="B2C" />
                  {customers.map(c => <option key={c.id} value={c.name} />)}
                </datalist>
              </div>
            )}
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: 11, color: '#71717a', display: 'block', marginBottom: 2 }}>NOTE (optional)</label>
              <input value={scanNote} onChange={e => setScanNote(e.target.value)} placeholder="Any note..."
                style={{ width: '100%', padding: '10px 12px', borderRadius: 6, border: '1px solid #27272a', background: '#0c0c0e', color: '#fafafa', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
            </div>
          </div>

          {/* Scanned product info */}
          {(() => {
            const matched = products.find(p => p.sku === scanSku);
            return matched ? (
              <div style={{ background: '#0c0c0e', borderRadius: 8, padding: 10, marginBottom: 12, border: '1px solid #27272a', display: 'flex', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{matched.name}</div>
                  <div style={{ fontSize: 11, color: '#71717a' }}>{matched.sku} · {matched.category} · Stock: {matched.current_stock}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: scanMode === 'inbound' ? '#22c55e' : '#f59e0b' }}>
                    {scanMode === 'inbound' ? `+${scanQty}` : `-${scanQty}`}
                  </div>
                </div>
              </div>
            ) : scanSku ? (
              <div style={{ background: '#1e1e1e', borderRadius: 8, padding: 10, marginBottom: 12, color: '#f87171', fontSize: 12 }}>
                ⚠ Product not found: {scanSku}. Add it in Products tab first.
              </div>
            ) : null;
          })()}

          <button onClick={async () => {
            if (!scanSku || !scanQty) return;
            const now = new Date().toISOString().slice(0, 10);
            if (scanMode === 'inbound') {
              await api.recordInbound({ product_sku: scanSku, quantity: scanQty, po_number: '', inbound_date: now, note: scanNote });
            } else {
              await api.recordOutbound({
                product_sku: scanSku, quantity: scanQty, channel: scanCustomer && scanCustomer !== 'B2C' ? 'B2B' : 'B2C',
                customer_name: scanCustomer === 'B2C' ? '' : scanCustomer, shopify_order_id: '', outbound_date: now, note: scanNote,
              });
            }
            setMessage(`${scanMode === 'inbound' ? 'Inbound' : 'Outbound'} recorded: ${scanSku} x${scanQty}`);
            setTimeout(() => setMessage(''), 3000);
            setScanBarcode(''); setScanSku(''); setScanQty(1); setScanCustomer(''); setScanNote('');
            loadAll();
          }} disabled={!scanSku || !scanQty}
            style={{ width: '100%', padding: 12, borderRadius: 8, border: 'none', background: !scanSku || !scanQty ? '#27272a' : scanMode === 'inbound' ? '#22c55e' : '#f59e0b', color: 'white', fontSize: 14, fontWeight: 700, cursor: !scanSku || !scanQty ? 'not-allowed' : 'pointer' }}>
            {scanMode === 'inbound' ? '✅ Confirm Inbound' : '✅ Confirm Outbound'}
          </button>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{
              padding: '8px 16px', borderRadius: 8, border: 'none',
              background: tab === t.key ? t.color : '#18181b',
              color: tab === t.key ? 'white' : '#a1a1aa',
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'stock' && <StockTab products={products} onRefresh={loadAll} />}
      {tab === 'inbound' && <InboundTab inbounds={inbounds} products={products} onRefresh={loadAll} />}
      {tab === 'outbound' && <OutboundTab outbounds={outbounds} products={products} customers={customers} onRefresh={loadAll} />}
      {tab === 'customers' && <CustomersTab customers={customers} onRefresh={loadAll} />}
      {tab === 'alerts' && <AlertsTab alerts={alerts} products={products} />}
    </div>
  );
}

// ── Stock Tab ──
function StockTab({ products, onRefresh }: { products: Product[]; onRefresh: () => void }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ sku: '', name: '', barcode: '', category: 'General', vendor: '', unit: 'Box', unit_price: 0, reorder_point: 50, reorder_qty: 1000 });
  const [search, setSearch] = useState('');

  const filtered = search ? products.filter(p =>
    p.sku.toLowerCase().includes(search.toLowerCase()) || p.name.toLowerCase().includes(search.toLowerCase())
  ) : products;

  const statusColor = (s: string) => s === 'out_of_stock' ? '#ef4444' : s === 'low_stock' ? '#f59e0b' : '#22c55e';
  const statusLabel = (s: string) => s === 'out_of_stock' ? 'Out' : s === 'low_stock' ? 'Low' : 'OK';

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by SKU or name..."
          style={{ flex: 1, padding: '10px 14px', borderRadius: 8, border: '1px solid #27272a', background: '#0c0c0e', color: '#fafafa', fontSize: 13, outline: 'none' }} />
        <button onClick={() => setShowForm(true)}
          style={{ padding: '10px 18px', borderRadius: 8, border: 'none', background: '#2563eb', color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
          + Product
        </button>
      </div>

      {showForm && (
        <div style={{ background: '#18181b', borderRadius: 12, padding: 16, marginBottom: 12, border: '1px solid #27272a' }}>
          <h4 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 12px' }}>New Product</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
            {['sku', 'name', 'barcode', 'category', 'vendor', 'unit'].map(f => (
              <div key={f}>
                <label style={{ fontSize: 11, color: '#71717a', display: 'block', marginBottom: 2 }}>{f.toUpperCase()}</label>
                <input value={(form as any)[f] || ''} onChange={e => setForm({ ...form, [f]: e.target.value })}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #27272a', background: '#0c0c0e', color: '#fafafa', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
              </div>
            ))}
            {['unit_price', 'reorder_point', 'reorder_qty'].map(f => (
              <div key={f}>
                <label style={{ fontSize: 11, color: '#71717a', display: 'block', marginBottom: 2 }}>{f.toUpperCase()}</label>
                <input type="number" value={(form as any)[f] || ''} onChange={e => setForm({ ...form, [f]: Number(e.target.value) })}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #27272a', background: '#0c0c0e', color: '#fafafa', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={async () => {
              await api.createProduct(form);
              setShowForm(false);
              setForm({ sku: '', name: '', category: 'General', vendor: '', unit: 'Box', unit_price: 0, reorder_point: 50, reorder_qty: 1000 });
              onRefresh();
            }} style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: '#2563eb', color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              Save
            </button>
            <button onClick={() => setShowForm(false)} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #27272a', background: 'transparent', color: '#a1a1aa', fontSize: 12, cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div style={{ background: '#0c0c0e', borderRadius: 12, border: '1px solid #27272a', overflow: 'hidden' }}>
        {filtered.length === 0 ? (
          <p style={{ textAlign: 'center', padding: 40, color: '#71717a', fontSize: 13 }}>No products yet. Add your first product.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #27272a' }}>
                {['SKU', 'Name', 'Category', 'Stock', 'In', 'Out', 'Status', 'Reorder'].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: '#71717a', fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.sku} style={{ borderBottom: '1px solid #18181b' }}>
                  <td style={{ padding: '10px 12px' }}><code style={{ color: '#60a5fa' }}>{p.sku}</code></td>
                  <td style={{ padding: '10px 12px', fontWeight: 500 }}>{p.name}</td>
                  <td style={{ padding: '10px 12px', color: '#71717a' }}>{p.category}</td>
                  <td style={{ padding: '10px 12px', fontWeight: 700 }}>{p.current_stock ?? 0}</td>
                  <td style={{ padding: '10px 12px', color: '#22c55e' }}>{p.total_inbound ?? 0}</td>
                  <td style={{ padding: '10px 12px', color: '#f59e0b' }}>{p.total_outbound ?? 0}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{ background: statusColor(p.status), color: 'white', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600 }}>{statusLabel(p.status)}</span>
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <span onClick={async () => {
                      const val = prompt(`Set reorder point for ${p.sku} (current: ${p.current_stock}):`, String(p.reorder_point));
                      if (val !== null) {
                        const num = parseInt(val.replace(/\D/g, ''), 10) || 0;
                        // Use full product update to ensure it persists
                        await api.createProduct({
                          sku: p.sku, name: p.name, category: p.category, vendor: p.vendor,
                          unit: p.unit, unit_price: p.unit_price, reorder_point: num,
                          reorder_qty: p.reorder_qty, source: p.source, id: 1,
                        } as any);
                        onRefresh();
                      }
                    }}
                      style={{ cursor: 'pointer', color: p.current_stock <= p.reorder_point ? '#ef4444' : '#71717a', padding: '2px 6px', borderRadius: 4, borderBottom: '1px dashed #27272a' }}>
                      {p.reorder_point} ✏️
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Inbound Tab ──
function InboundTab({ inbounds, products, onRefresh }: { inbounds: InboundRecord[]; products: Product[]; onRefresh: () => void }) {
  const [sku, setSku] = useState(''); const [qty, setQty] = useState(0); const [po, setPo] = useState(''); const [date, setDate] = useState(new Date().toISOString().slice(0, 10)); const [note, setNote] = useState('');

  const record = async () => {
    if (!sku || !qty) return;
    await api.recordInbound({ product_sku: sku, quantity: qty, po_number: po, inbound_date: date, note });
    setSku(''); setQty(0); setPo(''); setNote('');
    onRefresh();
  };

  return (
    <div>
      <div style={{ background: '#18181b', borderRadius: 12, padding: 16, marginBottom: 12, border: '1px solid #27272a' }}>
        <h4 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 12px' }}>Record Inbound</h4>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 11, color: '#71717a', display: 'block', marginBottom: 2 }}>SKU</label>
            <input list="sku-list" value={sku} onChange={e => setSku(e.target.value)} placeholder="Select or type SKU"
              style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #27272a', background: '#0c0c0e', color: '#fafafa', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
            <datalist id="sku-list">{products.map(p => <option key={p.sku} value={p.sku} label={p.name} />)}</datalist>
          </div>
          <div>
            <label style={{ fontSize: 11, color: '#71717a', display: 'block', marginBottom: 2 }}>QUANTITY</label>
            <input type="number" value={qty || ''} onChange={e => setQty(Number(e.target.value))} style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #27272a', background: '#0c0c0e', color: '#fafafa', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: '#71717a', display: 'block', marginBottom: 2 }}>PO NUMBER</label>
            <input value={po} onChange={e => setPo(e.target.value)} placeholder="PO-2026-001" style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #27272a', background: '#0c0c0e', color: '#fafafa', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: '#71717a', display: 'block', marginBottom: 2 }}>DATE</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #27272a', background: '#0c0c0e', color: '#fafafa', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <label style={{ fontSize: 11, color: '#71717a', display: 'block', marginBottom: 2 }}>NOTE</label>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="Optional note" style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #27272a', background: '#0c0c0e', color: '#fafafa', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
          </div>
        </div>
        <button onClick={record} disabled={!sku || !qty}
          style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: !sku || !qty ? '#27272a' : '#22c55e', color: 'white', fontSize: 12, fontWeight: 600, cursor: !sku || !qty ? 'not-allowed' : 'pointer' }}>
          Save Inbound
        </button>
      </div>

      <div style={{ background: '#0c0c0e', borderRadius: 12, border: '1px solid #27272a', overflow: 'hidden' }}>
        <h4 style={{ fontSize: 13, fontWeight: 600, padding: 12, margin: 0, borderBottom: '1px solid #18181b' }}>Inbound History</h4>
        {inbounds.length === 0 ? (
          <p style={{ textAlign: 'center', padding: 30, color: '#71717a', fontSize: 12 }}>No inbound records yet</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #27272a' }}>
                {['Date', 'SKU', 'Qty', 'PO#', 'Note'].map(h => <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: '#71717a', fontWeight: 600 }}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {inbounds.slice().reverse().map(r => (
                <tr key={r.id} style={{ borderBottom: '1px solid #18181b' }}>
                  <td style={{ padding: '8px 10px' }}>{r.inbound_date}</td>
                  <td style={{ padding: '8px 10px' }}><code style={{ color: '#60a5fa' }}>{r.product_sku}</code></td>
                  <td style={{ padding: '8px 10px', fontWeight: 600 }}>{r.quantity}</td>
                  <td style={{ padding: '8px 10px', color: '#71717a' }}>{r.po_number || '—'}</td>
                  <td style={{ padding: '8px 10px', color: '#71717a' }}>{r.note || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Outbound Tab ──
function OutboundTab({ outbounds, products, customers, onRefresh }: { outbounds: OutboundRecord[]; products: Product[]; customers: Customer[]; onRefresh: () => void }) {
  const [sku, setSku] = useState(''); const [qty, setQty] = useState(0); const [channel, setChannel] = useState<'B2C' | 'B2B'>('B2C');
  const [customerName, setCustomerName] = useState(''); const [date, setDate] = useState(new Date().toISOString().slice(0, 10)); const [note, setNote] = useState('');

  const record = async () => {
    if (!sku || !qty) return;
    await api.recordOutbound({ product_sku: sku, quantity: qty, channel, customer_name: customerName, shopify_order_id: '', outbound_date: date, note });
    setSku(''); setQty(0); setNote('');
    onRefresh();
  };

  const b2b = outbounds.filter(o => o.channel === 'B2B');
  const b2c = outbounds.filter(o => o.channel === 'B2C');

  return (
    <div>
      <div style={{ background: '#18181b', borderRadius: 12, padding: 16, marginBottom: 12, border: '1px solid #27272a' }}>
        <h4 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 12px' }}>Record Outbound</h4>
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {['B2C', 'B2B'].map(c => (
            <button key={c} onClick={() => { setChannel(c as typeof channel); if (c === 'B2C') setCustomerName(''); }}
              style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: channel === c ? '#f59e0b' : '#27272a', color: 'white', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
              {c}
            </button>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 11, color: '#71717a', display: 'block', marginBottom: 2 }}>SKU</label>
            <input list="out-sku-list" value={sku} onChange={e => setSku(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #27272a', background: '#0c0c0e', color: '#fafafa', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
            <datalist id="out-sku-list">{products.map(p => <option key={p.sku} value={p.sku} label={p.name} />)}</datalist>
          </div>
          <div>
            <label style={{ fontSize: 11, color: '#71717a', display: 'block', marginBottom: 2 }}>QUANTITY</label>
            <input type="number" value={qty || ''} onChange={e => setQty(Number(e.target.value))} style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #27272a', background: '#0c0c0e', color: '#fafafa', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: '#71717a', display: 'block', marginBottom: 2 }}>DATE</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #27272a', background: '#0c0c0e', color: '#fafafa', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
          </div>
          {channel === 'B2B' && (
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: 11, color: '#71717a', display: 'block', marginBottom: 2 }}>CUSTOMER</label>
              <input list="cust-list" value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Select or type customer"
                style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #27272a', background: '#0c0c0e', color: '#fafafa', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
              <datalist id="cust-list">{customers.map(c => <option key={c.id} value={c.name} />)}</datalist>
            </div>
          )}
          <div style={{ gridColumn: 'span 2' }}>
            <label style={{ fontSize: 11, color: '#71717a', display: 'block', marginBottom: 2 }}>NOTE</label>
            <input value={note} onChange={e => setNote(e.target.value)} style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #27272a', background: '#0c0c0e', color: '#fafafa', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
          </div>
        </div>
        <button onClick={record} disabled={!sku || !qty}
          style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: !sku || !qty ? '#27272a' : '#f59e0b', color: 'white', fontSize: 12, fontWeight: 600, cursor: !sku || !qty ? 'not-allowed' : 'pointer' }}>
          Save Outbound
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{ background: '#0c0c0e', borderRadius: 12, border: '1px solid #27272a', overflow: 'hidden' }}>
          <h4 style={{ fontSize: 13, fontWeight: 600, padding: 12, margin: 0, borderBottom: '1px solid #18181b' }}>B2C Outbound ({b2c.length})</h4>
          {b2c.length === 0 ? <p style={{ textAlign: 'center', padding: 20, color: '#71717a', fontSize: 11 }}>None</p> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <tbody>{b2c.slice().reverse().slice(0, 20).map(r => (
                <tr key={r.id} style={{ borderBottom: '1px solid #18181b' }}>
                  <td style={{ padding: '6px 8px' }}>{r.outbound_date}</td>
                  <td style={{ padding: '6px 8px' }}><code style={{ color: '#60a5fa' }}>{r.product_sku}</code></td>
                  <td style={{ padding: '6px 8px', fontWeight: 600 }}>-{r.quantity}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
        <div style={{ background: '#0c0c0e', borderRadius: 12, border: '1px solid #27272a', overflow: 'hidden' }}>
          <h4 style={{ fontSize: 13, fontWeight: 600, padding: 12, margin: 0, borderBottom: '1px solid #18181b' }}>B2B Outbound ({b2b.length})</h4>
          {b2b.length === 0 ? <p style={{ textAlign: 'center', padding: 20, color: '#71717a', fontSize: 11 }}>None</p> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <tbody>{b2b.slice().reverse().slice(0, 20).map(r => (
                <tr key={r.id} style={{ borderBottom: '1px solid #18181b' }}>
                  <td style={{ padding: '6px 8px' }}>{r.outbound_date}</td>
                  <td style={{ padding: '6px 8px' }}><code style={{ color: '#60a5fa' }}>{r.product_sku}</code></td>
                  <td style={{ padding: '6px 8px', fontWeight: 600 }}>-{r.quantity}</td>
                  <td style={{ padding: '6px 8px', color: '#a855f7' }}>{r.customer_name}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Customers Tab ──
function CustomersTab({ customers, onRefresh }: { customers: Customer[]; onRefresh: () => void }) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [ig, setIg] = useState(''); const [country, setCountry] = useState(''); const [type, setType] = useState('Studio');
  const [candidates, setCandidates] = useState<DistributorCandidate[]>([]);
  const [showCandidates, setShowCandidates] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);

  const save = async () => {
    if (!name) return;
    await api.saveCustomer({ name, email, instagram: ig, country, customer_type: type });
    setName(''); setEmail(''); setIg(''); setCountry(''); setType('Studio');
    setShowForm(false);
    onRefresh();
  };

  const loadCandidates = async () => {
    const c = await api.getDistributorCandidates();
    setCandidates(c);
    setShowCandidates(true);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 6 }}>
        <span style={{ fontSize: 13, color: '#71717a' }}>{customers.length} customers</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={loadCandidates} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #27272a', background: 'transparent', color: '#a1a1aa', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            📥 Import from Distributor Board
          </button>
          <button onClick={() => setShowForm(true)} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#a855f7', color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>+ Customer</button>
        </div>
      </div>

      {showForm && (
        <div style={{ background: '#18181b', borderRadius: 12, padding: 16, marginBottom: 12, border: '1px solid #27272a' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
            {[{ f: name, s: setName, l: 'Name' }, { f: email, s: setEmail, l: 'Email' }, { f: ig, s: setIg, l: 'Instagram' }, { f: country, s: setCountry, l: 'Country' }].map(({ f, s, l }) => (
              <div key={l}>
                <label style={{ fontSize: 11, color: '#71717a', display: 'block', marginBottom: 2 }}>{l.toUpperCase()}</label>
                <input value={f} onChange={e => s(e.target.value)} style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #27272a', background: '#0c0c0e', color: '#fafafa', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={save} disabled={!name} style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: !name ? '#27272a' : '#a855f7', color: 'white', fontSize: 12, fontWeight: 600, cursor: !name ? 'not-allowed' : 'pointer' }}>Save</button>
            <button onClick={() => setShowForm(false)} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #27272a', background: 'transparent', color: '#a1a1aa', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Distributor candidates */}
      {showCandidates && (
        <div style={{ background: '#18181b', borderRadius: 12, marginBottom: 12, border: '1px solid #27272a', overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #27272a' }}>
            <h4 style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>Distributor Candidates ({candidates.length})</h4>
            <button onClick={() => setShowCandidates(false)} style={{ background: 'none', border: 'none', color: '#71717a', cursor: 'pointer', fontSize: 14 }}>X</button>
          </div>
          {candidates.length === 0 ? (
            <p style={{ padding: 20, color: '#71717a', fontSize: 12, textAlign: 'center' }}>No candidates found</p>
          ) : (
            <div style={{ maxHeight: 300, overflowY: 'auto' }}>
              {candidates.map(c => {
                const name = c.shop_name || c.full_name || c.username || 'Unknown';
                return (
                  <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 14px', borderBottom: '1px solid #18181b' }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 500 }}>{name}</div>
                      <div style={{ fontSize: 10, color: '#71717a' }}>
                        {c.ig_handle && <span>@{c.ig_handle} · </span>}
                        {c.city && <span>{c.city}</span>}
                      </div>
                    </div>
                    <button onClick={async () => {
                      setImporting(c.id);
                      await api.importDistributor(c.id);
                      setImporting(null);
                      onRefresh();
                    }} disabled={importing === c.id}
                      style={{ padding: '6px 12px', borderRadius: 6, border: 'none', background: importing === c.id ? '#27272a' : '#a855f7', color: 'white', fontSize: 10, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                      {importing === c.id ? '...' : 'Import'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div style={{ background: '#0c0c0e', borderRadius: 12, border: '1px solid #27272a', overflow: 'hidden' }}>
        {customers.length === 0 ? (
          <p style={{ textAlign: 'center', padding: 40, color: '#71717a', fontSize: 13 }}>No customers yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ borderBottom: '1px solid #27272a' }}>
              {['Name', 'Email', 'Instagram', 'Country', 'Type', 'Orders', 'Status'].map(h => (
                <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: '#71717a', fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>{customers.map(c => (
              <tr key={c.id} style={{ borderBottom: '1px solid #18181b' }}>
                <td style={{ padding: '10px 12px', fontWeight: 500 }}>{c.name}</td>
                <td style={{ padding: '10px 12px', color: '#71717a' }}>{c.email || '—'}</td>
                <td style={{ padding: '10px 12px', color: '#60a5fa' }}>{c.instagram || '—'}</td>
                <td style={{ padding: '10px 12px', color: '#71717a' }}>{c.country || '—'}</td>
                <td style={{ padding: '10px 12px' }}>{c.customer_type}</td>
                <td style={{ padding: '10px 12px' }}>{c.total_orders}</td>
                <td style={{ padding: '10px 12px' }}><span style={{ background: c.status === 'Active' ? '#22c55e' : '#71717a', color: 'white', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600 }}>{c.status}</span></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Alerts Tab ──
function AlertsTab({ alerts, products }: { alerts: StockAlert[]; products: Product[] }) {
  const urgent = alerts.filter(a => a.days_until_stockout_urgent === 'urgent');
  const warning = alerts.filter(a => a.days_until_stockout_urgent === 'warning');

  return (
    <div>
      {alerts.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <p style={{ fontSize: 16, color: '#22c55e', fontWeight: 600 }}>✓ All stock levels are healthy</p>
          <p style={{ fontSize: 13, color: '#71717a', marginTop: 4 }}>No reorder alerts at this time.</p>
        </div>
      ) : (
        <>
          {urgent.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <h4 style={{ fontSize: 13, fontWeight: 600, color: '#ef4444', margin: '0 0 8px' }}>⚠ Urgent — Order Now ({urgent.length})</h4>
              {urgent.map(a => <AlertCard alert={a} />)}
            </div>
          )}
          {warning.length > 0 && (
            <div>
              <h4 style={{ fontSize: 13, fontWeight: 600, color: '#f59e0b', margin: '0 0 8px' }}>Warning — Reorder Soon ({warning.length})</h4>
              {warning.map(a => <AlertCard alert={a} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function AlertCard({ alert }: { alert: StockAlert }) {
  const stockLeft = alert.current_stock;
  const dailyUse = alert.avg_daily_usage || 1;
  const daysLeft = dailyUse > 0 ? Math.round(stockLeft / dailyUse) : 999;
  return (
    <div style={{ background: '#18181b', borderRadius: 10, padding: 12, marginBottom: 8, border: '1px solid #27272a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div>
        <div style={{ fontWeight: 600, fontSize: 13 }}>{alert.name}</div>
        <div style={{ fontSize: 11, color: '#71717a' }}>{alert.sku} · {alert.category}</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: stockLeft <= alert.reorder_point ? '#ef4444' : '#f59e0b' }}>{stockLeft}</div>
        <div style={{ fontSize: 10, color: '#71717a' }}>stock / reorder at {alert.reorder_point}</div>
        <div style={{ fontSize: 10, color: '#71717a' }}>≈ {daysLeft} days left · suggest +{alert.suggested_reorder_qty}</div>
      </div>
    </div>
  );
}
