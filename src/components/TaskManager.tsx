import React, { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { cn } from '../lib/utils'
import { toast } from 'sonner'
import {
  ListTodo, Send, Loader2, Search, CheckSquare, ShoppingCart, Clock,
  CheckCircle, XCircle, AlertTriangle, RefreshCw, FileText
} from 'lucide-react'

type TaskRow = {
  id: string
  payload: string
  status: string
  run_at: number
  leased_by: string | null
  attempts: number
  error_reason: string | null
  created_at: number
  updated_at: number
}

type Competitor = {
  ig_handle?: string
  handle?: string
  account_type: string
  source: string
}

export default function TaskManager() {
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [stats, setStats] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')
  const [competitors, setCompetitors] = useState<Competitor[]>([])
  const [selectedCompetitors, setSelectedCompetitors] = useState<string[]>([])
  const [competitorSearch, setCompetitorSearch] = useState('')
  const [dispatching, setDispatching] = useState(false)
  const [dispatchMode, setDispatchMode] = useState<'auto' | 'manual'>('auto')
  const [accountType, setAccountType] = useState<'supply_brand' | 'supply_distributor'>('supply_brand')

  const fetchTasks = useCallback(async () => {
    setLoading(true)
    try {
      const url = statusFilter
        ? `/api/automation/tasks?status=${statusFilter}&limit=50`
        : '/api/automation/tasks?limit=50'
      const res = await fetch(url)
      const data = await res.json()
      setTasks(Array.isArray(data) ? data : [])
    } catch { setTasks([]) }
    try {
      const res = await fetch('/api/automation/stats')
      setStats(await res.json())
    } catch {}
    setLoading(false)
  }, [statusFilter])

  const fetchCompetitors = useCallback(async () => {
    try {
      const res = await fetch('/api/content/competitors')
      const data = await res.json()
      const list = Array.isArray(data) ? data : data?.rows || []
      setCompetitors(list.map((c: any) => ({
        ig_handle: c.ig_handle || c.handle || '',
        account_type: c.account_type || 'supply_brand',
        source: c.source || '',
      })))
    } catch {}
  }, [])

  useEffect(() => { fetchTasks() }, [fetchTasks])
  useEffect(() => { fetchCompetitors() }, [fetchCompetitors])

  const filteredCompetitors = competitors.filter(c => {
    const matchType = c.account_type === accountType
    const search = competitorSearch.toLowerCase()
    const handle = (c.ig_handle || '').toLowerCase()
    return matchType && (!search || handle.includes(search))
  })

  const handleDispatch = async () => {
    if (dispatchMode === 'manual' && selectedCompetitors.length === 0) {
      toast.error('Please select at least one competitor')
      return
    }
    setDispatching(true)
    try {
      const body: Record<string, any> = {}
      if (dispatchMode === 'manual') {
        body.handles = selectedCompetitors
      } else {
        body.accountType = accountType
        body.limit = 10
      }
      const res = await fetch('/api/automation/generate-from-competitors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Dispatch failed')
      toast.success(`Created ${data.created} tasks (${data.skipped} skipped)`)
      fetchTasks()
    } catch (e: any) {
      toast.error(e.message || 'Dispatch failed')
    }
    setDispatching(false)
  }

  const toggleCompetitor = (handle: string) => {
    setSelectedCompetitors(prev =>
      prev.includes(handle) ? prev.filter(h => h !== handle) : [...prev, handle]
    )
  }

  const statusColors: Record<string, string> = {
    pending: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    leased: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    running: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
    done: 'text-green-400 bg-green-500/10 border-green-500/20',
    failed: 'text-red-400 bg-red-500/10 border-red-500/20',
  }

  return (
    <div className="space-y-8">
      {/* Stats */}
      <div className="grid grid-cols-5 gap-4">
        {['pending', 'leased', 'running', 'done', 'failed'].map(s => (
          <div key={s} className={cn(
            "p-4 rounded-2xl border",
            statusColors[s] || 'text-zinc-400 bg-zinc-900/50 border-zinc-800'
          )}>
            <p className="text-2xl font-black">{stats[s] || 0}</p>
            <p className="text-[10px] font-bold uppercase tracking-widest mt-1 opacity-70">{s}</p>
          </div>
        ))}
      </div>

      {/* Dispatch Controls */}
      <div className="p-6 bg-zinc-900/50 border border-zinc-800 rounded-[2rem]">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-cyan-500/10 rounded-2xl flex items-center justify-center border border-cyan-500/20">
            <Send className="w-5 h-5 text-cyan-500" />
          </div>
          <div>
            <h3 className="text-lg font-black text-white">Dispatch Supply Tasks</h3>
            <p className="text-xs text-zinc-500">Generate automation tasks from competitors</p>
          </div>
        </div>

        {/* Account Type */}
        <div className="flex gap-2 mb-4">
          {(['supply_brand', 'supply_distributor'] as const).map(t => (
            <button
              key={t}
              onClick={() => setAccountType(t)}
              className={cn(
                "px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all",
                accountType === t
                  ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                  : "bg-zinc-800/50 text-zinc-500 border border-transparent hover:border-zinc-700"
              )}
            >
              {t === 'supply_brand' ? 'Brands' : 'Distributors'}
            </button>
          ))}
        </div>

        {/* Mode Toggle */}
        <div className="flex gap-2 mb-4">
          {(['auto', 'manual'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setDispatchMode(mode)}
              className={cn(
                "px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2",
                dispatchMode === mode
                  ? mode === 'auto'
                    ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                    : "bg-violet-500/20 text-violet-400 border border-violet-500/30"
                  : "bg-zinc-800/50 text-zinc-500 border border-transparent hover:border-zinc-700"
              )}
            >
              {mode === 'auto' ? <RefreshCw className="w-3 h-3" /> : <CheckSquare className="w-3 h-3" />}
              {mode === 'auto' ? 'Auto (top 10)' : 'Manual Pick'}
            </button>
          ))}
        </div>

        {/* Manual Selector */}
        {dispatchMode === 'manual' && (
          <div className="mb-4">
            <input
              type="text"
              value={competitorSearch}
              onChange={e => setCompetitorSearch(e.target.value)}
              placeholder="Search competitors..."
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-xl text-sm text-white focus:outline-none focus:border-violet-500/50 mb-2"
            />
            <div className="flex items-center gap-3 mb-2 text-xs">
              <button onClick={() => setSelectedCompetitors(filteredCompetitors.map(c => c.ig_handle || c.handle || ''))} className="font-bold text-violet-400 hover:text-violet-300">
                Select All
              </button>
              <button onClick={() => setSelectedCompetitors([])} className="font-bold text-zinc-500 hover:text-zinc-400">
                Deselect All
              </button>
              <span className="text-zinc-600">{selectedCompetitors.length} / {filteredCompetitors.length} selected</span>
            </div>
            <div className="max-h-40 overflow-y-auto space-y-1 border border-zinc-800 rounded-xl p-2">
              {filteredCompetitors.map(c => {
                const handle = c.ig_handle || c.handle || ''
                const sel = selectedCompetitors.includes(handle)
                return (
                  <label key={handle} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-zinc-800/50 cursor-pointer transition-colors">
                    <input type="checkbox" checked={sel} onChange={() => toggleCompetitor(handle)} className="accent-violet-500" />
                    <span className="text-sm font-medium text-zinc-300">@{handle}</span>
                    <span className="text-[10px] text-zinc-600 ml-auto">{c.source}</span>
                  </label>
                )
              })}
              {filteredCompetitors.length === 0 && (
                <p className="text-sm text-zinc-600 text-center py-4">No competitors found</p>
              )}
            </div>
          </div>
        )}

        <button
          disabled={dispatching || (dispatchMode === 'manual' && selectedCompetitors.length === 0)}
          onClick={handleDispatch}
          className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-bold rounded-xl transition-all flex items-center justify-center gap-2"
        >
          {dispatching ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Dispatching...</>
          ) : dispatchMode === 'manual' ? (
            <><Send className="w-4 h-4" /> Dispatch Selected ({selectedCompetitors.length})</>
          ) : (
            <><Send className="w-4 h-4" /> Auto-Dispatch {accountType === 'supply_brand' ? 'Brands' : 'Distributors'}</>
          )}
        </button>
      </div>

      {/* Task List */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <ListTodo className="w-5 h-5 text-zinc-400" />
            <h3 className="text-lg font-black text-white">Task List</h3>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-xl text-xs text-white focus:outline-none"
            >
              <option value="">All Status</option>
              <option value="pending">Pending</option>
              <option value="leased">Leased</option>
              <option value="running">Running</option>
              <option value="done">Done</option>
              <option value="failed">Failed</option>
            </select>
            <button onClick={fetchTasks} className="p-2 bg-zinc-800 hover:bg-zinc-700 rounded-xl transition-colors">
              <RefreshCw className={cn("w-4 h-4 text-zinc-400", loading && "animate-spin")} />
            </button>
          </div>
        </div>

        <div className="bg-zinc-900/50 border border-zinc-800 rounded-[2rem] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-500 uppercase tracking-widest text-[10px] font-black">
                  <th className="text-left px-4 py-3">ID</th>
                  <th className="text-left px-4 py-3">Handle</th>
                  <th className="text-left px-4 py-3">Type</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Attempts</th>
                  <th className="text-left px-4 py-3">Leased By</th>
                  <th className="text-left px-4 py-3">Updated</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map(t => {
                  let payload: any = {}
                  try { payload = typeof t.payload === 'string' ? JSON.parse(t.payload) : t.payload } catch {}
                  const handle = payload.artistHandle || payload.artistId || '-'
                  const type = payload.taskType || '-'
                  return (
                    <tr key={t.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                      <td className="px-4 py-3 font-mono text-[9px] text-zinc-500">{t.id.slice(0, 24)}…</td>
                      <td className="px-4 py-3 font-medium text-zinc-200">@{handle}</td>
                      <td className="px-4 py-3 text-zinc-400">{type}</td>
                      <td className="px-4 py-3">
                        <span className={cn("px-2 py-0.5 rounded-lg text-[9px] font-bold border", statusColors[t.status] || 'text-zinc-500')}>
                          {t.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-zinc-400">{t.attempts}/3</td>
                      <td className="px-4 py-3 text-zinc-500">{t.leased_by || '-'}</td>
                      <td className="px-4 py-3 text-zinc-500">{new Date(t.updated_at).toLocaleString()}</td>
                    </tr>
                  )
                })}
                {tasks.length === 0 && !loading && (
                  <tr><td colSpan={7} className="text-center py-12 text-zinc-600">No tasks found</td></tr>
                )}
                {loading && (
                  <tr><td colSpan={7} className="text-center py-12"><Loader2 className="w-5 h-5 animate-spin text-zinc-500 mx-auto" /></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
