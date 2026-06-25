import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import { Loader2, Search, Database, CheckSquare, Square, Filter, ChevronLeft, ChevronRight, PlusCircle, ListTodo, Clock, CheckCircle, XCircle } from 'lucide-react';

const API = 'https://harvests-api.inkflowapp.workers.dev/api/automation';

export default function DataDashboard() {
  const [artists, setArtists] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [stateFilter, setStateFilter] = useState('');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [states, setStates] = useState<string[]>([]);
  const [selectAll, setSelectAll] = useState(false);
  const [error, setError] = useState('');
  const [debug, setDebug] = useState('');
  const [taskCounts, setTaskCounts] = useState<any>({});
  const searchTimer = useRef<any>(null);

  useEffect(() => { loadArtists(); loadTaskCounts(); }, []);
  useEffect(() => { const t = setInterval(loadTaskCounts, 5000); return () => clearInterval(t); }, []);

  const loadTaskCounts = async () => {
    try {
      const res = await fetch(`${API}/task-counts`);
      if (res.ok) {
        const data = await res.json();
        setTaskCounts(data.counts || {});
      }
    } catch {}
  };

  const loadArtists = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (stateFilter) params.set('state', stateFilter);
      if (search) params.set('search', search);
      const res = await fetch(`${API}/artists?${params}`);
      const data = await res.json();
      if (data.ok) {
        setArtists(data.items || []);
        setPages(data.pages || 1);
        setTotal(data.total || 0);
        setError('');
        setDebug(`OK: ${data.total} items, page ${data.page}/${data.pages}`);
        if (!states.length && data.items?.length) {
          const unique = [...new Set(data.items.map((a: any) => a.import_region).filter(Boolean))] as string[];
          setStates(unique);
        }
      } else {
        setError(data.error || 'Unknown error');
        setDebug(JSON.stringify(data).slice(0, 200));
      }
    } catch (e: any) {
      setError(e.message);
      setDebug('');
      toast.error('加载失败', { description: e.message });
    }
    setLoading(false);
  }, [page, stateFilter, search]);

  const handleSearch = (val: string) => {
    setSearch(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setPage(1); loadArtists(); }, 500);
  };

  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setSelectAll(false);
  };

  const toggleSelectAll = () => {
    if (selectAll) { setSelected(new Set()); setSelectAll(false); }
    else { setSelected(new Set(artists.map(a => a.id))); setSelectAll(true); }
  };

  const createTasks = async () => {
    if (!selected.size) { toast.error('请先勾选艺术家'); return; }
    setCreating(true);
    try {
      const res = await fetch(`${API}/tasks/create-from-artists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artistIds: [...selected], taskType: 'ig_browse' }),
      });
      const data = await res.json();
      if (data.ok) {
        toast.success(`✅ 创建 ${data.created} 个任务，跳过 ${data.skipped} 个（已存在）`);
        setSelected(new Set());
        setSelectAll(false);
        loadArtists();
      } else throw new Error(data.error);
    } catch (e: any) {
      toast.error('创建失败', { description: e.message });
    }
    setCreating(false);
  };

  const loadStates = async () => {
    try {
      const res = await fetch(`${API}/artists?limit=1`);
      const data = await res.json();
      if (data.ok && data.items?.length) {
        const unique = [...new Set(data.items.map((a: any) => a.state).filter(Boolean))] as string[];
        setStates(unique);
      }
    } catch {}
  };

  return (
    <div className="bg-[#111] border border-zinc-800/50 rounded-[2rem] p-6 mt-8">
      {/* Task Summary - always show */}
      <div className="flex items-center gap-4 mb-6 p-4 bg-zinc-900/50 rounded-xl border border-zinc-800/50">
        <button onClick={loadTaskCounts} className="text-[10px] text-zinc-500 hover:text-white transition-colors mr-2" title="刷新">🔄</button>
        <div className="flex items-center gap-2">
          <ListTodo className="w-4 h-4 text-amber-400" />
          <span className="text-xs text-zinc-400">待处理</span>
          <span className="text-lg font-black text-amber-400">{taskCounts.pending || 0}</span>
        </div>
        <div className="w-px h-8 bg-zinc-800" />
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-cyan-400" />
          <span className="text-xs text-zinc-400">执行中</span>
          <span className="text-lg font-black text-cyan-400">{taskCounts.leased || 0}</span>
        </div>
        <div className="w-px h-8 bg-zinc-800" />
        <div className="flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-green-400" />
          <span className="text-xs text-zinc-400">已完成</span>
          <span className="text-lg font-black text-green-400">{taskCounts.done || 0}</span>
        </div>
        <div className="w-px h-8 bg-zinc-800" />
        <div className="flex items-center gap-2">
          <XCircle className="w-4 h-4 text-red-400" />
          <span className="text-xs text-zinc-400">失败</span>
          <span className="text-lg font-black text-red-400">{taskCounts.failed || 0}</span>
        </div>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Database className="w-5 h-5 text-emerald-500" />
          <h3 className="text-sm font-bold text-white">📊 数据看板</h3>
        </div>
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <span>共 <strong className="text-white">{total}</strong> 条</span>
          <span className="w-px h-4 bg-zinc-800" />
          <span>已选 <strong className="text-emerald-400">{selected.size}</strong></span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" />
          <input
            type="text"
            placeholder="搜索店铺/IG/城市..."
            value={search}
            onChange={e => handleSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs bg-zinc-900 border border-zinc-800 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:border-emerald-500/50"
          />
        </div>
        <select
          value={stateFilter}
          onChange={e => { setStateFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 text-xs bg-zinc-900 border border-zinc-800 rounded-xl text-white focus:outline-none focus:border-emerald-500/50"
        >
          <option value="">全部州</option>
          {states.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button
          onClick={createTasks}
          disabled={!selected.size || creating}
          className={cn(
            "flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl transition-all",
            selected.size && !creating
              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 cursor-pointer"
              : "bg-zinc-900 text-zinc-600 border border-zinc-800 cursor-not-allowed"
          )}
        >
          {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlusCircle className="w-3.5 h-3.5" />}
          创建任务 {selected.size > 0 && `(${selected.size})`}
        </button>
      </div>

      {/* Error / Debug */}
      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-xs text-red-400">
          ❌ {error}
          {debug && <pre className="mt-1 text-zinc-500 text-[10px]">{debug}</pre>}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-zinc-600 border-b border-zinc-800/50">
              <th className="w-10 py-2 pr-2 text-left">
                <button onClick={toggleSelectAll} className="hover:text-white transition-colors">
                  {selectAll ? <CheckSquare className="w-3.5 h-3.5 text-emerald-400" /> : <Square className="w-3.5 h-3.5" />}
                </button>
              </th>
              <th className="text-left py-2 pr-2 font-medium">店铺</th>
              <th className="text-left py-2 pr-2 font-medium">IG</th>
              <th className="text-left py-2 pr-2 font-medium">城市</th>
              <th className="text-left py-2 pr-2 font-medium">地区</th>
              <th className="text-left py-2 pr-2 font-medium">来源</th>
              <th className="text-left py-2 pr-2 font-medium">状态</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="py-12 text-center text-zinc-600"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></td></tr>
            ) : artists.length === 0 ? (
              <tr><td colSpan={6} className="py-12 text-center text-zinc-600">暂无数据</td></tr>
            ) : artists.map(a => (
              <tr key={a.id} className="border-b border-zinc-800/20 hover:bg-zinc-900/30 transition-colors">
                <td className="py-2 pr-2">
                  <button onClick={() => toggleSelect(a.id)} className="hover:text-white transition-colors">
                    {selected.has(a.id) ? <CheckSquare className="w-3.5 h-3.5 text-emerald-400" /> : <Square className="w-3.5 h-3.5 text-zinc-600" />}
                  </button>
                </td>
                <td className="py-2 pr-2 text-zinc-300 font-medium max-w-[200px] truncate">{a.shop_name || '—'}</td>
                <td className="py-2 pr-2 text-zinc-400">{a.ig_handle || '—'}</td>
                <td className="py-2 pr-2 text-zinc-400">{a.city || '—'}</td>
                <td className="py-2 pr-2"><span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-800 text-zinc-400">{a.import_region || '—'}</span></td>
                <td className="py-2 text-zinc-500">{a.import_region || (a as any).state || '—'}</td>
                <td className="py-2 pr-2">
                  {a.taskStatus === 'pending' ? <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/20 text-amber-400">待处理</span> :
                   a.taskStatus === 'leased' ? <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-cyan-500/20 text-cyan-400">执行中</span> :
                   a.taskStatus === 'done' ? <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-500/20 text-green-400">已完成</span> :
                   a.taskStatus === 'failed' ? <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/20 text-red-400">失败</span> :
                   <span className="text-zinc-600">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-zinc-800/50">
          <span className="text-[10px] text-zinc-600">第 {page}/{pages} 页</span>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              className="px-3 py-1.5 text-xs rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            ><ChevronLeft className="w-3 h-3" /></button>
            <button
              disabled={page >= pages}
              onClick={() => setPage(p => Math.min(pages, p + 1))}
              className="px-3 py-1.5 text-xs rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            ><ChevronRight className="w-3 h-3" /></button>
          </div>
        </div>
      )}

      {/* 采集数据 */}
      <ObservedData />
    </div>
  );
}

function ObservedData() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/observations?limit=20`);
      const data = await res.json();
      setItems(data.items || []);
    } catch {}
    setLoading(false);
  };
  useEffect(() => { load(); }, []);
  return (
    <div className="mt-6 pt-6 border-t border-zinc-800/50">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-sm font-bold text-white">📡 采集数据</h4>
        <button onClick={load} className="text-[10px] text-zinc-500 hover:text-white transition-colors">🔄 刷新</button>
      </div>
      {loading ? <p className="text-xs text-zinc-600">加载中...</p> : items.length === 0 ? (
        <p className="text-xs text-zinc-600">暂无采集数据</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead><tr className="text-zinc-600 border-b border-zinc-800/50">
              <th className="text-left py-2 pr-2 font-medium">Bot</th>
              <th className="text-left py-2 pr-2 font-medium">目标</th>
              <th className="text-left py-2 pr-2 font-medium">模式</th>
              <th className="text-left py-2 pr-2 font-medium">时间</th>
            </tr></thead>
            <tbody>
              {items.map((o: any) => (
                <tr key={o.id} className="border-b border-zinc-800/20">
                  <td className="py-2 pr-2 text-zinc-300">{o.bot_id}</td>
                  <td className="py-2 pr-2 text-zinc-400">@{o.artist_handle}</td>
                  <td className="py-2 pr-2"><span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-800 text-zinc-400">{o.mode}</span></td>
                  <td className="py-2 text-zinc-500">{o.created_at ? new Date(o.created_at).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
