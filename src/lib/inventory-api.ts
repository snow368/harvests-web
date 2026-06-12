// Inventory API service — calls backend server.ts endpoints
const API = '/api';

export interface Product {
  sku: string;
  name: string;
  category: string;
  vendor: string;
  unit: string;
  unit_price: number;
  reorder_point: number;
  reorder_qty: number;
  lead_time_days: number;
  moq: number;
  carton_qty: number;
  source: string;
  barcode?: string;
  image_url?: string;
  current_stock: number;
  total_inbound: number;
  total_outbound: number;
  status: string;
}

export interface InboundRecord {
  id: number;
  product_sku: string;
  quantity: number;
  po_number: string;
  inbound_date: string;
  note: string;
  created_at: number;
}

export interface OutboundRecord {
  id: number;
  product_sku: string;
  quantity: number;
  channel: 'B2C' | 'B2B';
  customer_name: string;
  shopify_order_id: string;
  outbound_date: string;
  note: string;
  created_at: number;
}

export interface Customer {
  id: number;
  name: string;
  email: string;
  instagram: string;
  country: string;
  customer_type: string;
  total_orders: number;
  total_spent: number;
  last_order_date: string;
  first_order_date: string;
  avg_order_days: number;
  status: string;
  notes: string;
  b2b_order_count?: number;
  b2b_total_units?: number;
}

export interface StockAlert {
  sku: string;
  name: string;
  category: string;
  current_stock: number;
  reorder_point: number;
  avg_daily_usage: number;
  suggested_reorder_qty: number;
  days_until_empty: number;
  days_until_stockout_urgent: string;
}

export async function getStock(): Promise<Product[]> {
  const res = await fetch(`${API}/inventory/stock`);
  const data = await res.json();
  return data.items || [];
}

export async function getProductAlerts(): Promise<StockAlert[]> {
  const res = await fetch(`${API}/inventory/alerts`);
  const data = await res.json();
  return data.alerts || [];
}

export async function getTrends() {
  const res = await fetch(`${API}/inventory/trends`);
  return res.json();
}

export async function createProduct(product: Partial<Product>) {
  const res = await fetch(`${API}/inventory/product`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(product),
  });
  return res.json();
}

export async function updateProductField(sku: string, field: string, value: any) {
  const res = await fetch(`${API}/inventory/product/${sku}/field`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ field, value }),
  });
  return res.json();
}

export async function deleteProduct(sku: string) {
  const res = await fetch(`${API}/inventory/product/${sku}`, { method: 'DELETE' });
  return res.json();
}

export async function recordInbound(data: { product_sku: string; quantity: number; po_number: string; inbound_date: string; note: string }) {
  const res = await fetch(`${API}/inventory/inbound`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function recordOutbound(data: { product_sku: string; quantity: number; channel: string; customer_name: string; shopify_order_id: string; outbound_date: string; note: string }) {
  const res = await fetch(`${API}/inventory/outbound`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function getInbounds(): Promise<InboundRecord[]> {
  const res = await fetch(`${API}/inventory/inbounds`);
  const data = await res.json();
  return data.items || [];
}

export async function getOutbounds(channel?: string, sku?: string): Promise<OutboundRecord[]> {
  let url = `${API}/inventory/outbounds`;
  const params = new URLSearchParams();
  if (channel) params.set('channel', channel);
  if (sku) params.set('sku', sku);
  if (params.toString()) url += `?${params.toString()}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.items || [];
}

export interface DistributorCandidate {
  id: string; shop_name: string; full_name: string; username: string;
  bio: string; ig_handle: string; website: string; city: string; metadata: any;
}

export async function getDistributorCandidates(): Promise<DistributorCandidate[]> {
  const res = await fetch(`${API}/inventory/distributor-candidates`);
  const data = await res.json();
  return data.items || [];
}

export async function importDistributor(artistId: string) {
  const res = await fetch(`${API}/inventory/import-distributor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ artistId }),
  });
  return res.json();
}

export async function getCustomers(): Promise<Customer[]> {
  const res = await fetch(`${API}/inventory/customers`);
  const data = await res.json();
  return data.items || [];
}

export async function saveCustomer(customer: Partial<Customer>) {
  const res = await fetch(`${API}/inventory/customer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(customer),
  });
  return res.json();
}

export async function createPO(data: { items: { sku: string; quantity: number; unit_cost: number }[]; supplier: string; expected_date: string; notes: string }) {
  const res = await fetch(`${API}/inventory/po/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function getPOs() {
  const res = await fetch(`${API}/inventory/po`);
  const data = await res.json();
  return data.items || [];
}

export async function getPOItems(id: number) {
  const res = await fetch(`${API}/inventory/po/${id}/items`);
  const data = await res.json();
  return data.items || [];
}
