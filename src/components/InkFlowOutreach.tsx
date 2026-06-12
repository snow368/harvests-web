import React, { useState, useEffect, useCallback } from 'react';
import {
  Users,
  Search,
  Send,
  MessageSquare,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Globe,
  Send as SendIcon,
  Phone,
  Mail,
  Link2,
  Loader2,
  ArrowUpDown,
  Sparkles,
  BookOpen,
  RefreshCw,
  Target,
  TrendingUp,
  Star,
  Filter,
  ExternalLink,
  UserCheck,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { toast } from 'sonner';

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/30',
  contacted: 'bg-blue-500/10 text-blue-500 border-blue-500/30',
  replied: 'bg-green-500/10 text-green-500 border-green-500/30',
  scheduled: 'bg-purple-500/10 text-purple-500 border-purple-500/30',
  trialing: 'bg-cyan-500/10 text-cyan-500 border-cyan-500/30',
  case_study: 'bg-amber-500/10 text-amber-500 border-amber-500/30',
  rejected: 'bg-red-500/10 text-red-500 border-red-500/30',
  paid: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30',
  churned: 'bg-orange-500/10 text-orange-500 border-orange-500/30',
};

const LANGUAGE_TEMPLATES = [
  {
    lang: 'en',
    label: '🇬🇧 英文模板',
    intro: "Hey there! Love your tattoo work — really inspiring! 🔥",
    pitch: "I'm building a free management tool for tattoo studios (scheduling, client database, inventory). Would love to get your honest feedback and maybe feature you as a beta tester.",
    followUp: "Just checking if you got my last message! No pressure at all — if you're curious, I can set up a quick demo for your team.",
    close: "Totally understand! If you ever change your mind, here's my link: {link}. Also happy to share a case study from another studio if that helps.",
  },
  {
    lang: 'zh',
    label: '🇨🇳 中文模板',
    intro: "嗨！看了你们的纹身作品，太棒了！🔥",
    pitch: "我在做一个免费的纹身工作室管理软件（预约、客户管理、库存）。想听听你们的意见，也欢迎成为我们的测试用户。",
    followUp: "之前发的消息你看到了吗？不急的～如果有兴趣可以帮你快速搭建测试环境。",
    close: "没关系！如果以后有需要随时找我。另外我也可以分享其他工作室的使用案例给你参考。",
  },
];

function DMTemplateSection({ target }: { target: any }) {
  const [selectedLang, setSelectedLang] = useState(0);
  const [template, setTemplate] = useState<'intro' | 'pitch' | 'followUp' | 'close'>('intro');
  const lang = LANGUAGE_TEMPLATES[selectedLang];

  return (
    <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
      <h4 className="text-sm font-medium text-slate-300 mb-3 flex items-center gap-2">
        <Sparkles size={14} className="text-amber-400" />
        外联话术模板
      </h4>
      <div className="flex gap-2 mb-3">
        {LANGUAGE_TEMPLATES.map((l, i) => (
          <button
            key={l.lang}
            onClick={() => setSelectedLang(i)}
            className={cn('px-3 py-1 rounded text-xs border', selectedLang === i ? STATUS_COLORS[lang.lang] : 'bg-slate-700 text-slate-400 border-slate-600')}
          >
            {l.label}
          </button>
        ))}
      </div>
      <div className="flex gap-2 mb-3 flex-wrap">
        {(['intro', 'pitch', 'followUp', 'close'] as const).map((step) => {
          const labels: Record<string, string> = { intro: '开场', pitch: '介绍', followUp: '跟进', close: '收尾' };
          return (
            <button
              key={step}
              onClick={() => setTemplate(step)}
              className={cn('px-3 py-1 rounded text-xs', template === step ? 'bg-rose-600 text-white' : 'bg-slate-700 text-slate-400')}
            >
              {labels[step]}
            </button>
          );
        })}
      </div>
      <div className="bg-slate-900 rounded-lg p-3 text-sm text-slate-200 font-mono leading-relaxed">
        {lang[template].replace('{link}', '<your-link>')}
      </div>
      <div className="mt-2 flex gap-2">
        <button
          onClick={() => { 
            try { navigator.clipboard.writeText(lang[template]); toast.success('已复制'); } 
            catch { toast.error('复制失败'); } 
          }}
          className="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-xs text-slate-300 flex items-center gap-1"
        >
          <RefreshCw size={12} /> 复制
        </button>
      </div>
    </div>
  );
}

export default function InkFlowOutreach() {
  const [activeView, setActiveView] = useState<'stats' | 'candidates' | 'targets' | 'target-detail'>('stats');
  const [candidates, setCandidates] = useState<any[]>([]);
  const [targets, setTargets] = useState<any[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<any | null>(null);
  const [targetDetailLogs, setTargetDetailLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');
  const [targetFilterStatus, setTargetFilterStatus] = useState('');
  const [page, setPage] = useState(1);
  const [targetPage, setTargetPage] = useState(1);
  const [candidatesTotal, setCandidatesTotal] = useState(0);
  const [targetsTotal, setTargetsTotal] = useState(0);
  const [stats, setStats] = useState<any>(null);
  const [dmStats, setDmStats] = useState<any>({});
  const [outreachMessage, setOutreachMessage] = useState('');
  const [updateStatus, setUpdateStatus] = useState('');
  const [updateNotes, setUpdateNotes] = useState('');

  const api = useCallback(async (path: string, opts?: RequestInit) => {
    try {
      const res = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts?.headers as any) || {} } });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        toast.error(err.error || 'API error');
        return null;
      }
      return await res.json();
    } catch (e: any) {
      toast.error(e.message);
      return null;
    }
  }, []);

  const loadStats = useCallback(async () => {
    const data = await api('/api/inkflow/stats');
    if (data) {
      setStats(data);
      setDmStats(data.dmStats || {});
    }
  }, [api]);

  const loadCandidates = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: '50' });
    if (filterStatus) params.set('status', filterStatus);
    const data = await api(`/api/inkflow/candidates?${params}`);
    if (data) {
      setCandidates(data.candidates || []);
      setCandidatesTotal(data.pagination?.total || 0);
    }
    setLoading(false);
  }, [api, page, filterStatus]);

  const loadTargets = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(targetPage), limit: '50' });
    if (targetFilterStatus) params.set('status', targetFilterStatus);
    const data = await api(`/api/inkflow/targets?${params}`);
    if (data) {
      setTargets(data.targets || []);
      setTargetsTotal(data.pagination?.total || 0);
    }
    setLoading(false);
  }, [api, targetPage, targetFilterStatus]);

  const loadTargetDetail = useCallback(async (id: number) => {
    const data = await api(`/api/inkflow/target/${id}/logs`);
    if (data) setTargetDetailLogs(data.logs || []);
  }, [api]);

  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { if (activeView === 'candidates') loadCandidates(); }, [activeView, loadCandidates]);
  useEffect(() => { if (activeView === 'targets') loadTargets(); }, [activeView, loadTargets]);

  const handleAutoFilter = useCallback(async () => {
    const data = await api('/api/inkflow/auto-filter', { method: 'POST' });
    if (data) {
      toast.success(`已自动筛选 ${data.filtered} 家店铺`);
      loadStats();
      loadTargets();
    }
  }, [api, loadStats, loadTargets]);

  const handleOutreachLog = useCallback(async (targetId: number, action: string) => {
    if (action === 'sent' && !outreachMessage.trim()) {
      toast.error('请输入外联消息');
      return;
    }
    const data = await api('/api/inkflow/outreach/log', {
      method: 'POST',
      body: JSON.stringify({ target_id: targetId, action, message: outreachMessage || undefined }),
    });
    if (data) {
      toast.success('已记录');
      setOutreachMessage('');
      loadTargets();
      loadStats();
      if (selectedTarget) loadTargetDetail(selectedTarget.id);
    }
  }, [api, outreachMessage, loadTargets, loadStats, loadTargetDetail, selectedTarget]);

  const handleUpdateTarget = useCallback(async (id: number) => {
    if (!updateStatus) return;
    const body: any = { status: updateStatus };
    // Auto-set plan based on status
    if (updateStatus === 'paid') body.plan = 'pro';
    if (updateStatus === 'churned') body.plan = 'free';
    // Monthly revenue by plan
    if (updateStatus === 'paid') body.monthly_revenue = 99; // default pro plan
    if (updateStatus === 'churned') body.monthly_revenue = 0;
    if (updateNotes) body.notes = updateNotes;
    
    const data = await api(`/api/inkflow/target/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    if (data) {
      toast.success('已更新');
      setUpdateStatus('');
      setUpdateNotes('');
      loadTargets();
      loadStats();
      if (selectedTarget) loadTargetDetail(selectedTarget.id);
    }
  }, [api, updateStatus, updateNotes, loadTargets, loadStats, loadTargetDetail, selectedTarget]);

  // Helper: count DMs sent
  const dmSent = dmStats.sent || 0;
  const dmReplied = dmStats.replied || 0;
  const replyRate = dmSent > 0 ? Math.round((dmReplied / dmSent) * 100) : 0;

  // Helper: get response message from logs
  const getLastResponse = (targetId: number) => {
    const lastLog = targetDetailLogs.find((l: any) => l.action === 'replied');
    return lastLog?.message || null;
  };

  // ---- STATS VIEW ----
  if (activeView === 'stats') {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-slate-100">InkFlow 获客系统</h2>
            <p className="text-slate-400 text-sm mt-1">Shared Resource Pool — Snow Only</p>
          </div>
        </div>

        {/* Resource pool stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <div className="flex items-center gap-2 mb-2">
              <Users size={16} className="text-blue-400" />
              <span className="text-sm text-slate-400">共享候选池</span>
            </div>
            <div className="text-2xl font-bold text-slate-100">{stats?.candidates ?? '-'}</div>
          </div>
          <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <div className="flex items-center gap-2 mb-2">
              <Search size={16} className="text-amber-400" />
              <span className="text-sm text-slate-400">筛选目标</span>
            </div>
            <div className="text-2xl font-bold text-slate-100">{stats?.targets ?? '-'}</div>
          </div>
          <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <div className="flex items-center gap-2 mb-2">
              <UserCheck size={16} className="text-green-400" />
              <span className="text-sm text-slate-400">试用中</span>
            </div>
            <div className="text-2xl font-bold text-green-400">{stats?.byStatus?.trialing ?? 0}</div>
          </div>
          <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <div className="flex items-center gap-2 mb-2">
              <Star size={16} className="text-amber-400" />
              <span className="text-sm text-slate-400">案例研究</span>
            </div>
            <div className="text-2xl font-bold text-amber-400">{stats?.byStatus?.case_study ?? 0}</div>
          </div>
          <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp size={16} className="text-emerald-400" />
              <span className="text-sm text-slate-400">月营收 (MRR)</span>
            </div>
            <div className="text-2xl font-bold text-emerald-400">${stats?.totalMrr ?? 0}</div>
          </div>
        </div>

        {/* DM Outreach Pipeline */}
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <h3 className="text-sm font-medium text-slate-400 mb-4">📱 DM 外联漏斗</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-slate-100">{dmSent}</div>
              <div className="text-xs text-slate-400 mt-1">已发送</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-400">{dmReplied}</div>
              <div className="text-xs text-slate-400 mt-1">已回复</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-400">{dmStats.scheduled ?? 0}</div>
              <div className="text-xs text-slate-400 mt-1">预约访谈</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-cyan-400">{dmStats.trialing ?? 0}</div>
              <div className="text-xs text-slate-400 mt-1">试用</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-amber-400">{dmStats.case_study ?? 0}</div>
              <div className="text-xs text-slate-400 mt-1">案例</div>
            </div>
          </div>
          {dmSent > 0 && (
            <div className="mt-4 pt-3 border-t border-slate-700">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>回复率: {replyRate}%</span>
                <div className="w-32 h-2 bg-slate-700 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.min(replyRate, 100)}%` }}></div>
                </div>
              </div>
            </div>
          )}
          {/* Funnel bar */}
          <div className="mt-4 flex items-center gap-1">
            {[
              { label: '目标', count: stats?.targets ?? 0, color: 'bg-slate-600' },
              { label: '已发DM', count: dmSent, color: 'bg-blue-500' },
              { label: '已回复', count: dmReplied, color: 'bg-green-500' },
              { label: '试用', count: dmStats.trialing ?? 0, color: 'bg-cyan-500' },
              { label: '案例', count: dmStats.case_study ?? 0, color: 'bg-amber-500' },
              { label: '付费', count: dmStats.paid ?? 0, color: 'bg-emerald-500' },
            ].filter((s) => s.count > 0).map((s, i, arr) => (
              <React.Fragment key={s.label}>
                <div className="flex-1">
                  <div className={cn('rounded p-2 text-center text-xs', s.color)}>
                    <div className="font-bold text-white">{s.count}</div>
                    <div className="text-white/70">{s.label}</div>
                  </div>
                </div>
                {i < arr.length - 1 && <ArrowRight size={12} className="text-slate-500 shrink-0" />}
              </React.Fragment>
            ))}
          </div>
        </div>

        <div className="flex gap-3">
          <button onClick={handleAutoFilter} className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-sm font-medium flex items-center gap-2">
            <Filter size={14} /> 自动筛选候选池
          </button>
          <button onClick={() => setActiveView('targets')} className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm flex items-center gap-2">
            <Users size={14} /> 查看目标列表
          </button>
          <button onClick={() => setActiveView('candidates')} className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm flex items-center gap-2">
            <Search size={14} /> 查看候选池
          </button>
        </div>
        {stats?.byStatus && (
          <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <h3 className="text-sm font-medium text-slate-400 mb-3">目标状态分布</h3>
            <div className="flex flex-wrap gap-2">
              {Object.entries(stats.byStatus).map(([status, count]) => (
                <span key={status} className={cn('px-3 py-1 rounded-full text-xs border', STATUS_COLORS[status] || 'bg-slate-700 text-slate-300 border-slate-600')}>
                  {status}: {count}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ---- CANDIDATES VIEW ----
  if (activeView === 'candidates') {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-slate-100">共享候选池 ({candidatesTotal} 条)</h2>
          <div className="flex gap-2">
            <button onClick={() => setActiveView('stats')} className="px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm">← 返回</button>
            <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }} className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white">
              <option value="">全部状态</option>
              <option value="raw">raw</option>
              <option value="processed">processed</option>
            </select>
          </div>
        </div>
        <div className="space-y-2">
          {loading ? (
            <div className="flex items-center justify-center py-12"><Loader2 size={24} className="animate-spin text-slate-400" /></div>
          ) : candidates.length === 0 ? (
            <div className="text-center py-12 text-slate-400">暂无候选数据</div>
          ) : (
            candidates.map((c: any) => (
              <div key={c.id} className="bg-slate-800 rounded-xl p-4 border border-slate-700 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-slate-600 flex items-center justify-center text-sm font-bold">{c.ig_handle?.[0]?.toUpperCase() || '?'}</div>
                  <div>
                    <div className="font-medium text-slate-100">@{c.ig_handle}</div>
                    <div className="text-xs text-slate-400">{c.followers} followers · {c.posts_count} posts</div>
                    {c.bio && <div className="text-xs text-slate-500 mt-1 line-clamp-1">{c.bio}</div>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn('px-2 py-1 rounded text-xs border', STATUS_COLORS[c.status] || 'bg-slate-700 text-slate-300 border-slate-600')}>{c.status}</span>
                  {c.ig_url && (
                    <a href={c.ig_url} target="_blank" rel="noopener" className="p-1 hover:bg-slate-600 rounded">
                      <ExternalLink size={14} className="text-slate-400" />
                    </a>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
        {candidatesTotal > 0 && (
          <div className="flex items-center justify-center gap-2">
            <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1} className="p-2 rounded-lg bg-slate-700 disabled:opacity-30"><ChevronLeft size={16} /></button>
            <span className="text-sm text-slate-400">Page {page}</span>
            <button onClick={() => setPage(page + 1)} disabled={page * 50 >= candidatesTotal} className="p-2 rounded-lg bg-slate-700 disabled:opacity-30"><ChevronRight size={16} /></button>
          </div>
        )}
      </div>
    );
  }

  // ---- TARGETS VIEW (detail or list) ----
  if (activeView === 'target-detail' && selectedTarget) {
    const lastResponse = getLastResponse(selectedTarget.id);

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <button onClick={() => { setActiveView('targets'); setSelectedTarget(null); }} className="px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm">← 返回列表</button>
          <h2 className="text-xl font-bold text-slate-100">@{selectedTarget.ig_handle}</h2>
          {selectedTarget.ig_url && (
            <a href={selectedTarget.ig_url} target="_blank" rel="noopener" className="p-1 hover:bg-slate-600 rounded">
              <ExternalLink size={16} className="text-slate-400" />
            </a>
          )}
        </div>

        {/* Target info */}
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div>
              <div className="text-xs text-slate-400">状态</div>
              <span className={cn('px-2 py-1 rounded text-xs border mt-1 block w-fit', STATUS_COLORS[selectedTarget.status] || 'bg-slate-700')}>{selectedTarget.status}</span>
            </div>
            <div><div className="text-xs text-slate-400">粉丝</div><div className="text-slate-100">{selectedTarget.followers}</div></div>
            <div><div className="text-xs text-slate-400">联系方式</div><div className="text-slate-100">{selectedTarget.contact_method || '-'}</div></div>
            <div><div className="text-xs text-slate-400">案例研究</div><div className="text-slate-100">{selectedTarget.case_study_status || 'none'}</div></div>
            <div>
              <div className="text-xs text-slate-400">套餐</div>
              <span className={cn('px-2 py-1 rounded text-xs border mt-1 block w-fit',
                selectedTarget.plan === 'premium' ? 'bg-purple-500/10 text-purple-400 border-purple-500/30' :
                selectedTarget.plan === 'pro' ? 'bg-blue-500/10 text-blue-400 border-blue-500/30' :
                'bg-slate-700 text-slate-300 border-slate-600'
              )}>{selectedTarget.plan || 'free'}</span>
            </div>
          </div>
          {selectedTarget.subscription_status && (
            <div className="mt-2 text-xs text-slate-500">订阅: {selectedTarget.subscription_status} | 月收: ${selectedTarget.monthly_revenue || 0}</div>
          )}
          {selectedTarget.trial_ends_at && (
            <div className="mt-1 text-xs text-amber-500">试用期截止: {selectedTarget.trial_ends_at}</div>
          )}
          {selectedTarget.bio && <div className="mt-3 text-sm text-slate-400">Bio: {selectedTarget.bio}</div>}
          {selectedTarget.notes && <div className="mt-2 text-sm text-slate-500">Notes: {selectedTarget.notes}</div>}
        </div>

        {/* DM History - what was sent & what they replied */}
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <h3 className="text-sm font-medium text-slate-400 mb-3 flex items-center gap-2">
            <MessageSquare size={14} /> DM 对话记录
          </h3>
          {targetDetailLogs.length === 0 ? (
            <div className="text-sm text-slate-500">暂无外联记录</div>
          ) : (
            <div className="space-y-3">
              {targetDetailLogs.map((log: any) => {
                const isOutbound = log.action === 'sent';
                const isInbound = ['replied', 'triaging', 'scheduled'].includes(log.action);
                return (
                  <div key={log.id} className={cn('rounded-lg p-3', isOutbound ? 'bg-blue-900/20 border border-blue-500/20' : isInbound ? 'bg-green-900/20 border border-green-500/20' : 'bg-slate-900/50')}>
                    <div className="flex items-center justify-between mb-1">
                      <span className={cn('px-2 py-0.5 rounded text-xs font-medium',
                        isOutbound ? 'bg-blue-500/20 text-blue-400' :
                        isInbound ? 'bg-green-500/20 text-green-400' :
                        STATUS_COLORS[log.action] || 'bg-slate-700 text-slate-300'
                      )}>
                        {isOutbound ? '📤 你发送' : isInbound ? '📥 对方回复' : log.action}
                      </span>
                      <span className="text-xs text-slate-500">{log.created_at?.split('T')[0]}</span>
                    </div>
                    {log.message && <div className="text-sm text-slate-200">{log.message}</div>}
                    {!log.message && isOutbound && <div className="text-xs text-slate-500">（空消息 - 仅标记已发送）</div>}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Response analysis & follow-up language suggestion */}
        {lastResponse && (
          <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <h3 className="text-sm font-medium text-slate-400 mb-2 flex items-center gap-2">
              <BookOpen size={14} /> 对方回复分析
            </h3>
            <div className="text-sm text-slate-200">{lastResponse}</div>
            <div className="mt-2 flex gap-2">
              <button onClick={() => handleOutreachLog(selectedTarget.id, 'triaging')} className="px-3 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-xs">分析中</button>
              <button onClick={() => handleOutreachLog(selectedTarget.id, 'trialing')} className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-xs">开始试用</button>
              <button onClick={() => handleOutreachLog(selectedTarget.id, 'scheduled')} className="px-3 py-1 rounded bg-purple-600 hover:bg-purple-500 text-xs">预约访谈</button>
            </div>
          </div>
        )}

        {/* Follow-up language templates */}
        <DMTemplateSection target={selectedTarget} />

        {/* Update status */}
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <h3 className="text-sm font-medium text-slate-400 mb-3">更新状态</h3>
          <div className="flex flex-wrap gap-2 mb-3">
            {['pending', 'contacted', 'replied', 'scheduled', 'trialing', 'case_study', 'rejected', 'paid', 'churned'].map(s => (
              <button key={s} onClick={() => setUpdateStatus(s)} className={cn('px-3 py-1 rounded text-xs border', updateStatus === s ? STATUS_COLORS[s] : 'bg-slate-700 text-slate-300 border-slate-600')}>{s}</button>
            ))}
          </div>
          <textarea value={updateNotes} onChange={(e) => setUpdateNotes(e.target.value)} placeholder="备注" className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm text-white mb-2" rows={2} />
          <button onClick={() => handleUpdateTarget(selectedTarget.id)} className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-sm font-medium">更新</button>
        </div>

        {/* Quick action buttons */}
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => { setOutreachMessage(''); handleOutreachLog(selectedTarget.id, 'sent'); }} className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-sm font-medium flex items-center gap-2">
            <SendIcon size={14} /> 标记已联系
          </button>
          <button onClick={() => handleOutreachLog(selectedTarget.id, 'replied')} className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-sm">已回复</button>
          <button onClick={() => handleOutreachLog(selectedTarget.id, 'scheduled')} className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-sm">预约访谈</button>
          <button onClick={() => handleOutreachLog(selectedTarget.id, 'trialing')} className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-sm">开始试用</button>
          <button onClick={() => handleOutreachLog(selectedTarget.id, 'case_study')} className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-sm">案例研究</button>
          <button onClick={() => { setUpdateStatus('paid'); handleUpdateTarget(selectedTarget.id); }} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm">💳 转为付费</button>
          <button onClick={() => { setUpdateStatus('churned'); handleUpdateTarget(selectedTarget.id); }} className="px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 text-sm">流失</button>
          <button onClick={() => handleOutreachLog(selectedTarget.id, 'rejected')} className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-sm">拒绝</button>
        </div>

        {/* Outreach message input */}
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <h3 className="text-sm font-medium text-slate-400 mb-2">发送 DM 消息</h3>
          <textarea
            value={outreachMessage}
            onChange={(e) => setOutreachMessage(e.target.value)}
            placeholder="输入 DM 内容..."
            className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm text-white mb-2"
            rows={3}
          />
        </div>
      </div>
    );
  }

  // ---- TARGETS LIST ----
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-100">InkFlow 目标 ({targetsTotal} 个)</h2>
        <div className="flex gap-2">
          <button onClick={() => setActiveView('stats')} className="px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm">← 返回</button>
          <button onClick={handleAutoFilter} className="px-3 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-sm">自动筛选</button>
          <select value={targetFilterStatus} onChange={(e) => { setTargetFilterStatus(e.target.value); setTargetPage(1); }} className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white">
            <option value="">全部状态</option>
            <option value="pending">pending</option>
            <option value="contacted">contacted</option>
            <option value="replied">replied</option>
            <option value="scheduled">scheduled</option>
            <option value="trialing">trialing</option>
            <option value="case_study">case_study</option>
            <option value="rejected">rejected</option>
          </select>
        </div>
      </div>
      <div className="space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-12"><Loader2 size={24} className="animate-spin text-slate-400" /></div>
        ) : targets.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <p>暂无筛选目标</p>
            <button onClick={handleAutoFilter} className="mt-2 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-sm">点击自动筛选</button>
          </div>
        ) : (
          targets.map((t: any) => (
            <div key={t.id} onClick={() => { setSelectedTarget(t); setActiveView('target-detail'); loadTargetDetail(t.id); }} className="bg-slate-800 rounded-xl p-4 border border-slate-700 hover:border-rose-500/30 cursor-pointer transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-slate-600 flex items-center justify-center text-sm font-bold">{t.ig_handle?.[0]?.toUpperCase() || '?'}</div>
                  <div>
                    <div className="font-medium text-slate-100">@{t.ig_handle}</div>
                    <div className="text-xs text-slate-400">{t.followers} followers</div>
                    {t.notes && <div className="text-xs text-slate-500 mt-1 line-clamp-1">{t.notes}</div>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn('px-2 py-1 rounded text-xs border', STATUS_COLORS[t.status] || 'bg-slate-700 text-slate-300 border-slate-600')}>{t.status}</span>
                  {t.ig_url && (
                    <a href={t.ig_url} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}><ExternalLink size={14} className="text-slate-400 hover:text-slate-200" /></a>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
      {targetsTotal > 0 && (
        <div className="flex items-center justify-center gap-2">
          <button onClick={() => setTargetPage(Math.max(1, targetPage - 1))} disabled={targetPage <= 1} className="p-2 rounded-lg bg-slate-700 disabled:opacity-30"><ChevronLeft size={16} /></button>
          <span className="text-sm text-slate-400">Page {targetPage}</span>
          <button onClick={() => setTargetPage(targetPage + 1)} disabled={targetPage * 50 >= targetsTotal} className="p-2 rounded-lg bg-slate-700 disabled:opacity-30"><ChevronRight size={16} /></button>
        </div>
      )}
    </div>
  );
}
