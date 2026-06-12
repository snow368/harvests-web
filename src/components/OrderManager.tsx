import { useEffect, useState } from 'react';

interface Gift {
  type: string;
  label: string;
  quantity: number;
  estimatedBoxes?: number;
}

interface Order {
  id: number;
  order_number: string;
  customer_name: string;
  customer_email: string;
  country: string;
  total: number;
  currency: string;
  status: string;
  created_at: number;
  tracking_number: string;
  carrier: string;
  notes: string;
  gifts: Gift[];
  items: any[];
}

export default function OrderManager() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState<Order | null>(null);

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/fulfillment/orders');
      const d = await r.json();
      setOrders(d.orders || []);
    } catch { setMessage('Failed to load orders'); }
    setLoading(false);
  };

  const syncOrders = async () => {
    setSyncing(true);
    setMessage('');
    try {
      const r = await fetch('/api/fulfillment/shopify/sync', { method: 'POST' });
      const d = await r.json();
      setMessage(`Synced ${d.synced} orders`);
      fetchOrders();
    } catch { setMessage('Sync failed'); }
    setSyncing(false);
  };

  const deleteOrder = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this order?')) return;
    try {
      await fetch(`/api/fulfillment/orders/${id}`, { method: 'DELETE' });
      fetchOrders();
    } catch { setMessage('Delete failed'); }
  };

  const openDetail = async (order: Order) => {
    try {
      const r = await fetch(`/api/fulfillment/orders/${order.id}`);
      const d = await r.json();
      setSelected(d);
    } catch { setMessage('Failed to load detail'); }
  };

  useEffect(() => { fetchOrders(); }, []);

  if (selected) {
    return (
      <div style={{ padding: '20px' }}>
        <button onClick={() => setSelected(null)} style={{ marginBottom: 16, padding: '6px 12px', cursor: 'pointer' }}>
          ← Back
        </button>
        <h2>#{selected.order_number}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
          <div><strong>Customer:</strong> {selected.customer_name}<br /><small>{selected.customer_email}</small></div>
          <div><strong>Country:</strong> {selected.country}</div>
          <div><strong>Status:</strong> {selected.status}</div>
          <div><strong>Tracking:</strong> {selected.tracking_number || '-'}</div>
        </div>
        {selected.notes && (
          <div style={{ marginBottom: 16, padding: 12, background: '#fff8e1', borderRadius: 6, border: '1px solid #ffe082' }}>
            <strong>📝 Notes:</strong> {selected.notes}
          </div>
        )}
        {selected.gifts && selected.gifts.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <h3>🎁 Gifts</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ background: '#f5f5f5', textAlign: 'left' }}>
                <th style={th}>Item</th><th style={th}>Type</th><th style={th}>Qty</th><th style={th}>Boxes</th>
              </tr></thead>
              <tbody>
                {selected.gifts.map((g, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={td}>{g.label}</td>
                    <td style={td}>{g.type === 'needle' ? '针' : g.type === 'poster' ? '海报' : g.type}</td>
                    <td style={td}>{g.quantity}</td>
                    <td style={td}>{g.estimatedBoxes || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {selected.items && selected.items.length > 0 && (
          <div>
            <h3>Items</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ background: '#f5f5f5', textAlign: 'left' }}>
                <th style={th}>Product</th><th style={th}>SKU</th><th style={th}>Qty</th><th style={th}>Price</th>
              </tr></thead>
              <tbody>
                {selected.items.map((item, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={td}>{item.product_name}</td>
                    <td style={td}>{item.sku || '-'}</td>
                    <td style={td}>{item.quantity}</td>
                    <td style={td}>${item.unit_price}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {selected.status !== 'shipped' && (
          <div style={{ marginTop: 20, padding: 16, background: '#f0f8ff', borderRadius: 8, border: '1px solid #b3d9ff' }}>
            <h3>🚚 Ship Order</h3>
            <div style={{ marginBottom: 8 }}>
              <strong>Total boxes:</strong> {selected.totalBoxes || 0} (items + gifts)
              {selected.giftBoxes > 0 && <span> (gifts: {selected.giftBoxes})</span>}
            </div>
            <ShipForm order={selected} onShipped={() => { setSelected(null); fetchOrders(); }} />
          </div>
        )}
      </div>
    );
  }

  function ShipForm({ order, onShipped }: { order: any; onShipped: () => void }) {
    const [boxes, setBoxes] = useState<any[]>([]);
    const [shipMsg, setShipMsg] = useState('');
    const [loading, setLoading] = useState(false);
    const [selectedBox, setSelectedBox] = useState(order.suggestedBox?.id || '');
    const carrier = ['US','CA'].includes(order.country) ? 'equick' : 'yanwen';

    useEffect(() => {
      fetch('/api/fulfillment/boxes').then(r => r.json()).then(setBoxes).catch(() => {});
    }, []);

    const doShip = async () => {
      setLoading(true); setShipMsg('');
      try {
        const r = await fetch(`/api/fulfillment/orders/${order.id}/ship`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ carrier, box_id: Number(selectedBox) || 0 }),
        });
        const d = await r.json();
        if (d.ok) setShipMsg(`✅ Shipped! Waybill: ${d.waybillNumber}`);
        else setShipMsg(`❌ ${d.error}`);
        onShipped();
      } catch { setShipMsg('❌ Shipment failed'); }
      setLoading(false);
    };

    return (
      <div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <label style={{ fontSize: 12, color: '#666' }}>Carrier</label><br />
            <strong>{carrier === 'equick' ? '巧捷(美国)' : '燕文物流'}</strong>
          </div>
          <div>
            <label style={{ fontSize: 12, color: '#666' }}>Box</label><br />
            <select value={selectedBox} onChange={e => setSelectedBox(e.target.value)}
              style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #ccc' }}>
              <option value="">-- Select --</option>
              {boxes.map(b => (
                <option key={b.id} value={b.id}>{b.name} ({b.length_cm}x{b.width_cm}x{b.height_cm}cm, max {b.max_units}盒)</option>
              ))}
            </select>
          </div>
          <button onClick={doShip} disabled={loading || !selectedBox}
            style={{ padding: '6px 16px', borderRadius: 4, border: 'none', background: '#007bff', color: '#fff', cursor: 'pointer', marginTop: 14 }}>
            {loading ? 'Shipping...' : '📦 Ship'}
          </button>
        </div>
        {shipMsg && <div style={{ marginTop: 8, fontSize: 13 }}>{shipMsg}</div>}
      </div>
    );
  }

  return (
    <div style={{ padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2 style={{ margin: 0 }}>Orders</h2>
        <button onClick={syncOrders} disabled={syncing}
          style={{ padding: '8px 16px', cursor: 'pointer', borderRadius: 6, border: '1px solid #ccc', background: syncing ? '#eee' : '#fff' }}>
          {syncing ? 'Syncing...' : '🔄 Sync Shopify'}
        </button>
      </div>
      {message && <div style={{ marginBottom: 12, padding: 8, background: '#e8f5e9', borderRadius: 4 }}>{message}</div>}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#f5f5f5', textAlign: 'left' }}>
            <th style={th}>Order</th>
            <th style={th}>Customer</th>
            <th style={th}>Country</th>
            <th style={th}>Notes</th>
            <th style={th}>Status</th>
            <th style={th}>Tracking</th>
            <th style={th}>Date</th>
            <th style={th}></th>
          </tr>
        </thead>
        <tbody>
          {orders.map(o => (
            <tr key={o.id} style={{ borderBottom: '1px solid #eee', cursor: 'pointer' }} onClick={() => openDetail(o)}>
              <td style={td}>#{o.order_number}</td>
              <td style={td}>{o.customer_name}<br /><small>{o.customer_email}</small></td>
              <td style={td}>{o.country}</td>
              <td style={td}>{o.notes ? '📝' : '-'}</td>
              <td style={td}>{o.status}</td>
              <td style={td}>{o.tracking_number || '-'}</td>
              <td style={td}>{new Date(o.created_at).toLocaleDateString()}</td>
              <td style={td}><button onClick={(e) => deleteOrder(o.id, e)} style={{ background:'none', border:'none', color:'#999', cursor:'pointer', fontSize:12 }}>✕</button></td>
            </tr>
          ))}
          {orders.length === 0 && !loading && (
            <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: '#999' }}>No orders yet. Click Sync to pull from Shopify.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

const th: React.CSSProperties = { padding: '10px 12px', fontWeight: 600, fontSize: 13, textTransform: 'uppercase', color: '#666' };
const td: React.CSSProperties = { padding: '10px 12px', fontSize: 14 };
