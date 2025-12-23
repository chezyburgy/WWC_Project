import { useEffect, useState } from 'react'
import DarkVeil from './components/DarkVeil'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4005'
const ORDER_SERVICE_BASE = 'http://localhost:4001'

type TimelineItem = { type: string; at: string; details?: any }

type OrderProjection = {
  _id: string
  currentStatus: string
  timeline: TimelineItem[]
}

export default function Dashboard() {
  console.log('[App] API_BASE:', API_BASE)
  const [orderId, setOrderId] = useState('')
  const [order, setOrder] = useState<OrderProjection | null>(null)
  const [log, setLog] = useState<TimelineItem[]>([])
  const [list, setList] = useState<OrderProjection[]>([])
  const FILTERS: { key: 'ALL' | 'SHIPPED' | 'PAYMENT_AUTHORIZED' | 'REFUNDED'; label: string }[] = [
    { key: 'ALL', label: 'All' },
    { key: 'SHIPPED', label: 'Delivered' },
    { key: 'PAYMENT_AUTHORIZED', label: 'Payment Done' },
    { key: 'REFUNDED', label: 'Refund' },
  ]
  const [filter, setFilter] = useState<typeof FILTERS[number]['key']>('ALL')
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newOrderForm, setNewOrderForm] = useState({ sku: '', qty: 1, total: 0 })
  const [createStatus, setCreateStatus] = useState<{ type: 'success' | 'error', msg: string } | null>(null)

  async function fetchList(status: typeof filter) {
    const url = status === 'ALL' ? `${API_BASE}/orders` : `${API_BASE}/orders?status=${status}`
    console.log('[fetchList] Fetching from:', url)
    try {
      const data = await fetch(url).then(r => r.json())
      console.log('[fetchList] Received data:', data.length, 'orders')
      setList(data)
    } catch (err) {
      console.error('[fetchList] Error:', err)
      setList([])
    }
  }

  async function fetchCounts() {
    console.log('[fetchCounts] Starting...')
    const keys: Array<typeof FILTERS[number]['key']> = ['SHIPPED', 'PAYMENT_AUTHORIZED', 'REFUNDED']
    const results = await Promise.all(
      keys.map(k => fetch(`${API_BASE}/orders?status=${k}`).then(r => r.json()).catch(() => []))
    )
    const next: Record<string, number> = {}
    keys.forEach((k, i) => (next[k] = results[i]?.length || 0))
    const all = await fetch(`${API_BASE}/orders`).then(r => r.json()).catch(() => [])
    next['ALL'] = all.length || 0
    console.log('[fetchCounts] Counts:', next)
    setCounts(next)
  }

  useEffect(() => {
    fetchList('ALL')
    fetchCounts()
  }, [])

  useEffect(() => {
    fetchList(filter)
  }, [filter])

  const connectSSE = (id: string) => {
    if (!id || id.trim() === '') {
      console.warn('[connectSSE] No orderId provided, skipping SSE connection')
      return
    }
    const es = new EventSource(`${API_BASE}/orders/${id}/stream`)
    es.onmessage = (e) => {
      const data = JSON.parse(e.data)
      setLog(l => [...l, { type: data.type, at: new Date(data.at).toISOString(), details: data.details }])
      setOrder(prev => prev ? { ...prev, currentStatus: data.status, timeline: [...(prev.timeline||[]), { type: data.type, at: data.at, details: data.details }] } : prev)
    }
    es.onerror = () => {
      es.close()
      setTimeout(() => connectSSE(id), 1000)
    }
  }

  const onLoad = async () => {
    if (!orderId || orderId.trim() === '') {
      console.warn('[onLoad] No orderId provided')
      return
    }
    try {
      const doc = await fetch(`${API_BASE}/orders/${orderId}`).then(r => r.json())
      setOrder(doc)
      setLog(doc.timeline || [])
      connectSSE(orderId)
    } catch (err) {
      console.error('[onLoad] Failed to load order:', err)
    }
  }

  const retry = async (step: 'inventory'|'payment'|'shipping') => {
    if (!orderId) return
    try {
      console.log(`[retry] Retrying ${step} for order:`, orderId)
      const response = await fetch(`${ORDER_SERVICE_BASE}/admin/retry/${orderId}`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ step }) 
      })
      
      if (response.ok) {
        console.log(`[retry] ${step} retry initiated successfully`)
        // Reload the order to see updated status
        setTimeout(() => onLoad(), 1000)
        // Refresh the list
        setTimeout(() => fetchList(filter), 1500)
      } else {
        console.error(`[retry] Failed to retry ${step}:`, response.status)
      }
    } catch (err) {
      console.error(`[retry] Error retrying ${step}:`, err)
    }
  }

  const compensate = async (action: 'releaseInventory'|'refundPayment') => {
    if (!orderId) return
    try {
      console.log(`[compensate] Executing ${action} for order:`, orderId)
      const response = await fetch(`${ORDER_SERVICE_BASE}/admin/compensate/${orderId}`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ action }) 
      })
      
      if (response.ok) {
        console.log(`[compensate] ${action} executed successfully`)
        // Reload the order to see updated status
        setTimeout(() => onLoad(), 1000)
        // Refresh the list
        setTimeout(() => fetchList(filter), 1500)
      } else {
        console.error(`[compensate] Failed to execute ${action}:`, response.status)
      }
    } catch (err) {
      console.error(`[compensate] Error executing ${action}:`, err)
    }
  }

  const downloadCSV = () => {
    console.log('[downloadCSV] Starting download, list length:', list.length)
    try {
      const headers = ['Order ID', 'Status', 'Created At', 'Last Updated']
      const rows = list.map(o => [
        o._id,
        o.currentStatus,
        o.timeline[0]?.at || '',
        o.timeline[o.timeline.length - 1]?.at || ''
      ])
      const csv = [headers, ...rows].map(row => row.join(',')).join('\n')
      console.log('[downloadCSV] CSV generated, length:', csv.length)
      
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `orders-${filter}-${new Date().toISOString().split('T')[0]}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      console.log('[downloadCSV] Download triggered successfully')
    } catch (err) {
      console.error('[downloadCSV] Error:', err)
    }
  }

  const downloadJSON = () => {
    console.log('[downloadJSON] Starting download, list length:', list.length)
    try {
      const data = list.map(o => ({
        orderId: o._id,
        status: o.currentStatus,
        createdAt: o.timeline[0]?.at || '',
        lastUpdated: o.timeline[o.timeline.length - 1]?.at || '',
        timeline: o.timeline
      }))
      const json = JSON.stringify(data, null, 2)
      console.log('[downloadJSON] JSON generated, length:', json.length)
      
      const blob = new Blob([json], { type: 'application/json;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `orders-${filter}-${new Date().toISOString().split('T')[0]}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      console.log('[downloadJSON] Download triggered successfully')
    } catch (err) {
      console.error('[downloadJSON] Error:', err)
    }
  }

  const createOrder = async () => {
    try {
      setCreateStatus(null)
      const orderData = {
        items: [{ sku: newOrderForm.sku, qty: newOrderForm.qty }],
        total: newOrderForm.total
      }
      const response = await fetch('http://localhost:4001/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderData)
      })
      if (!response.ok) throw new Error('Failed to create order')
      const result = await response.json()
      setCreateStatus({ type: 'success', msg: `Order ${result.orderId} created successfully!` })
      setNewOrderForm({ sku: '', qty: 1, total: 0 })
      setTimeout(() => {
        setShowCreateModal(false)
        setCreateStatus(null)
        fetchCounts()
        fetchList(filter)
      }, 2000)
    } catch (err: any) {
      setCreateStatus({ type: 'error', msg: err.message || 'Failed to create order' })
    }
  }

  return (
    <div className="relative min-h-screen text-slate-100">
      {/* full-viewport animated background */}
      <div className="fixed inset-0 -z-10 pointer-events-none">
        <DarkVeil className="opacity-90" hueShift={18} noiseIntensity={0.02} scanlineIntensity={0.06} scanlineFrequency={6} warpAmount={0.02} speed={0.5} />
        <div className="absolute inset-0 bg-gradient-to-br from-black/80 via-violet-950/40 to-black/90" />
      </div>

      {/* header */}
      <header className="px-8 py-8 mb-4">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-2">
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-violet-300 via-fuchsia-300 to-pink-300 drop-shadow-lg">
            Orders Dashboard
          </span>
        </h1>
        <p className="text-base text-slate-300/90 font-light">Live projections from the event stream</p>
      </header>

      <main className="px-8 pb-12 space-y-6">
        {/* controls */}
        <section className="card">
          <div className="card-body space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-violet-300">Order Controls</h3>
              <button 
                onClick={() => setShowCreateModal(true)} 
                className="btn btn-primary text-sm"
              >
                ➕ Create Order
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex items-center gap-3">
                <input
                  placeholder="Enter Order ID"
                  value={orderId}
                  onChange={e => setOrderId(e.target.value)}
                  className="input flex-1"
                />
                <button onClick={onLoad} disabled={!orderId} className="btn btn-primary whitespace-nowrap">
                  Load Order
                </button>
              </div>
              <div className="md:col-span-2 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <button onClick={() => retry('inventory')} disabled={!orderId} className="btn btn-secondary text-xs">
                  Retry Inventory
                </button>
                <button onClick={() => retry('payment')} disabled={!orderId} className="btn btn-secondary text-xs">
                  Retry Payment
                </button>
                <button onClick={() => retry('shipping')} disabled={!orderId} className="btn btn-secondary text-xs">
                  Retry Shipping
                </button>
                <button onClick={() => compensate('releaseInventory')} disabled={!orderId} className="btn btn-secondary text-xs">
                  Release Inventory
                </button>
                <button onClick={() => compensate('refundPayment')} disabled={!orderId} className="btn btn-secondary text-xs">
                  Refund Payment
                </button>
                <button onClick={() => { fetchCounts(); fetchList(filter); }} className="btn btn-ghost text-xs">
                  ↻ Refresh
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* grid */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* left: list */}
          <div className="card">
            <div className="card-body">
              <div className="flex items-center justify-between mb-4">
                <h2 className="card-title text-xl">Recent Orders ({list.length})</h2>
                <div className="flex gap-2">
                  <button 
                    onClick={(e) => { 
                      e.preventDefault(); 
                      console.log('[Button Click] CSV download clicked'); 
                      downloadCSV(); 
                    }}
                    disabled={list.length === 0}
                    className="btn btn-secondary text-xs px-3 py-2"
                    title={`Download ${list.length} orders as CSV`}
                  >
                    📥 CSV
                  </button>
                  <button 
                    onClick={(e) => { 
                      e.preventDefault(); 
                      console.log('[Button Click] JSON download clicked'); 
                      downloadJSON(); 
                    }}
                    disabled={list.length === 0}
                    className="btn btn-secondary text-xs px-3 py-2"
                    title={`Download ${list.length} orders as JSON`}
                  >
                    📥 JSON
                  </button>
                  <button 
                    onClick={() => { fetchCounts(); fetchList(filter); }} 
                    className="btn btn-secondary text-xs px-3 py-2"
                  >
                    ↻ Refresh
                  </button>
                </div>
              </div>
              
              <div className="flex flex-wrap gap-3 mb-5">
                {FILTERS.map(f => (
                  <button
                    key={f.key}
                    onClick={() => setFilter(f.key)}
                    className={`chip ${filter === f.key ? 'chip-active' : 'chip-inactive'}`}
                  >
                    {f.label}
                    <span className={`ml-2 px-2.5 py-0.5 rounded-full text-xs font-bold ${
                      filter === f.key 
                        ? 'bg-violet-400/40 text-violet-50' 
                        : 'bg-slate-700/60 text-slate-200'
                    }`}>
                      {counts[f.key] ?? '—'}
                    </span>
                  </button>
                ))}
              </div>

              <ul className="space-y-2">
                {list.map(o => (
                  <li 
                    key={o._id} 
                    className="py-3 px-4 rounded-lg bg-slate-900/50 border border-violet-500/10 hover:border-violet-400/30 hover:bg-slate-800/60 transition-all duration-200"
                  >
                    <div className="flex items-center gap-3">
                      <button 
                        className="text-left truncate hover:underline text-violet-300 font-mono text-sm flex-1" 
                        onClick={() => { setOrderId(o._id); onLoad() }}
                      >
                        {o._id}
                      </button>
                      <span className="badge text-xs">{o.currentStatus}</span>
                    </div>
                  </li>
                ))}
              </ul>
              {list.length === 0 && (
                <div className="mt-6 text-center py-8 px-4 rounded-lg bg-slate-900/30 border border-dashed border-slate-700">
                  <p className="text-slate-400">No orders match this filter</p>
                </div>
              )}
            </div>
          </div>

          {/* right: details */}
          <div className="lg:col-span-2 card">
            <div className="card-body">
              <h2 className="card-title text-xl mb-1">
                Order Details
              </h2>
              <p className="text-sm text-slate-300/90 mb-6">
                ID: <span className="font-mono text-violet-300">{order?._id || '—'}</span>
                {order && (
                  <>
                    {' · '}
                    <span className="font-semibold text-fuchsia-300">{order.currentStatus}</span>
                  </>
                )}
              </p>
              
              <h3 className="text-lg font-semibold text-violet-300 mb-4">Event Timeline</h3>
              <div className="space-y-2 max-h-96 overflow-y-auto pr-2">
                {(order?.timeline || []).map((t, i) => (
                  <div 
                    key={i} 
                    className="flex items-start gap-4 p-3 rounded-lg bg-slate-900/40 border border-violet-500/10 hover:border-violet-400/20 transition-colors"
                  >
                    <div className="flex-shrink-0 w-6 h-6 rounded-full bg-violet-500/30 border-2 border-violet-400/60 flex items-center justify-center">
                      <div className="w-2 h-2 rounded-full bg-violet-300"></div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-slate-400 mb-1 font-mono">
                        {new Date(t.at).toLocaleString()}
                      </div>
                      <div className="badge text-xs">{t.type}</div>
                    </div>
                  </div>
                ))}
                {(order?.timeline || []).length === 0 && (
                  <div className="text-center py-12 px-4 rounded-lg bg-slate-900/30 border border-dashed border-slate-700">
                    <p className="text-slate-400">No events yet. Load an order to view its timeline.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Create Order Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="card w-full max-w-md">
            <div className="card-body">
              <h2 className="card-title text-xl mb-4">Create New Order</h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-slate-300 mb-2">Product SKU</label>
                  <input
                    type="text"
                    placeholder="e.g., SKU-123"
                    value={newOrderForm.sku}
                    onChange={(e) => setNewOrderForm({ ...newOrderForm, sku: e.target.value })}
                    className="input w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm text-slate-300 mb-2">Quantity</label>
                  <input
                    type="number"
                    min="1"
                    value={newOrderForm.qty}
                    onChange={(e) => setNewOrderForm({ ...newOrderForm, qty: parseInt(e.target.value) || 1 })}
                    className="input w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm text-slate-300 mb-2">Total Amount</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={newOrderForm.total}
                    onChange={(e) => setNewOrderForm({ ...newOrderForm, total: parseFloat(e.target.value) || 0 })}
                    className="input w-full"
                  />
                </div>

                {createStatus && (
                  <div className={`p-3 rounded-lg ${
                    createStatus.type === 'success' 
                      ? 'bg-green-500/20 border border-green-400/30 text-green-200' 
                      : 'bg-red-500/20 border border-red-400/30 text-red-200'
                  }`}>
                    {createStatus.msg}
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={createOrder}
                    disabled={!newOrderForm.sku || newOrderForm.qty < 1 || newOrderForm.total <= 0}
                    className="btn btn-primary flex-1"
                  >
                    Create Order
                  </button>
                  <button
                    onClick={() => {
                      setShowCreateModal(false)
                      setCreateStatus(null)
                      setNewOrderForm({ sku: '', qty: 1, total: 0 })
                    }}
                    className="btn btn-ghost flex-1"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
