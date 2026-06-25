import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { cn } from '../lib/utils';
import {
  Link, Loader2, CheckCircle2, XCircle, Clock, AlertTriangle,
  RefreshCw, Play, Search, ExternalLink, BarChart3,
  Globe, FileText, Activity, Zap, Shield
} from 'lucide-react';

// ── 类型 ──
interface Stats {
  platforms: number;
  tasks: { total: number; pending: number; running: number; done: number };
  submissions: { total: number; success: number; paywall: number; captcha: number };
  assets: { total: number; indexed: number };
}

interface Project {
  id: string; name: string; domain: string; industry: string;
  priority: string; dailyQuota: number;
  stats: { tasks: number; pending: number; submitted: number; success: number; assets: number };
}

interface Submission {
  id: number; project_id: string; platform_id: string;
  target_url: string; status: string; submitted_at: number;
  checked_at: number; indexed: number; link_url: string | null;
  notes: string | null;
}

interface TaskItem {
  id: number; project_id: string; platform_id: string;
  status: string; result: string | null; error_log: string | null;
  platform_name: string; platform_dr: number; platform_difficulty: string;
}

// ── 状态徽章 ──
const StatusBadge = ({ status, size = 'sm' }: { status: string; size?: 'sm' | 'md' }) => {
  const config: Record<string, { color: string; bg: string; label: string; icon: React.ReactNode }> = {
    success:        { color: 'text-green-400', bg: 'bg-green-500/10', label: '成功', icon: <CheckCircle2 className="w-3 h-3" /> },
    pending_review: { color: 'text-yellow-400', bg: 'bg-yellow-500/10', label: '待确认', icon: <Clock className="w-3 h-3" /> },
    pending:        { color: 'text-blue-400', bg: 'bg-blue-500/10', label: '待执行', icon: <Clock className="w-3 h-3" /> },
    running:        { color: 'text-cyan-400', bg: 'bg-cyan-500/10', label: '执行中', icon: <Loader2 className="w-3 h-3 animate-spin" /> },
    paywall:        { color: 'text-orange-400', bg: 'bg-orange-500/10', label: '付费墙', icon: <AlertTriangle className="w-3 h-3" /> },
    captcha:        { color: 'text-purple-400', bg: 'bg-purple-500/10', label: '验证码', icon: <Shield className="w-3 h-3" /> },
    duplicate:      { color: 'text-zinc-400', bg: 'bg-zinc-500/10', label: '重复', icon: <XCircle className="w-3 h-3" /> },
    error:          { color: 'text-red-400', bg: 'bg-red-500/10', label: '错误', icon: <XCircle className="w-3 h-3" /> },
    done:           { color: 'text-green-400', bg: 'bg-green-500/10', label: '已完成', icon: <CheckCircle2 className="w-3 h-3" /> },
    failed:         { color: 'text-red-400', bg: 'bg-red-500/10', label: '失败', icon: <XCircle className="w-3 h-3" /> },
  };
  const c = config[status] || { color: 'text-zinc-400', bg: 'bg-zinc-500/10', label: status, icon: null };

  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold", c.color, c.bg)}>
      {c.icon}
      {c.label}
    </span>
  );
};

// ── 统计卡片 ──
const StatCard = ({ label, value, sub, icon, color }: {
  label: string; value: string | number; sub?: string; icon: React.ReactNode; color: string;
}) => (
  <div className="bg-zinc-900/60 border border-zinc-800/50 rounded-xl p-5 hover:border-zinc-700/50 transition-colors">
    <div className="flex items-start justify-between mb-3">
      <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider">{label}</span>
      <div className={cn("p-2 rounded-lg", color)}>{icon}</div>
    </div>
    <div className="text-2xl font-black text-white tracking-tight">{value}</div>
    {sub && <div className="text-[11px] text-zinc-600 mt-1">{sub}</div>}
  </div>
);

// ── 主组件 ──
export default function BacklinkManager() {
  const [activeProject, setActiveProject] = useState<string>('all');
  const [stats, setStats] = useState<Stats | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionLog, setActionLog] = useState<string[]>([]);
  const [tab, setTab] = useState<'actions' | 'status' | 'results'>('status');

  // ── 加载数据 ──
  const loadData = useCallback(async () => {
    try {
      const [statsRes, projectsRes, tasksRes, subRes] = await Promise.all([
        fetch('/api/backlinks/stats').then(r => r.json()),
        fetch('/api/backlinks/projects').then(r => r.json()),
        fetch('/api/backlinks/tasks?status=all').then(r => r.json()),
        fetch(`/api/backlinks/submissions?limit=30${activeProject !== 'all' ? `&project=${activeProject}` : ''}`).then(r => r.json()),
      ]);

      if (statsRes.ok) setStats(statsRes.stats);
      if (projectsRes.ok) setProjects(projectsRes.projects);
      if (tasksRes.ok) setTasks(tasksRes.tasks);
      if (subRes.ok) setSubmissions(subRes.submissions);
    } catch (e) {
      console.error('Failed to load backlink data:', e);
    } finally {
      setLoading(false);
    }
  }, [activeProject]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── 行动按钮 ──
  const runAction = async (action: string, endpoint: string, body?: any) => {
    setActionLoading(action);
    setActionLog(prev => [`> ${action}...`, ...prev]);
    try {
      const res = await fetch(endpoint, {
        method: ['schedule', 'execute', 'check'].includes(action) ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (data.output) {
        setActionLog(prev => [...data.output.slice(0, 10).reverse(), ...prev]);
      }
      if (data.ok) {
        setActionLog(prev => [`✅ ${action} 完成`, ...prev]);
        loadData();
      } else {
        setActionLog(prev => [`❌ ${action} 失败: ${data.error}`, ...prev]);
      }
    } catch (e: any) {
      setActionLog(prev => [`❌ ${action} 异常: ${e.message}`, ...prev]);
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-rose-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* ── 顶部标签切换 ── */}
      <div className="flex items-center gap-2 border-b border-zinc-800/50 pb-4">
        {[
          { id: 'status', label: '状态', icon: BarChart3 },
          { id: 'actions', label: '行动', icon: Zap },
          { id: 'results', label: '结果', icon: Activity },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id as any)}
            className={cn(
              "flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all",
              tab === t.id ? "bg-rose-600/10 text-rose-500 border border-rose-500/20" : "text-zinc-500 hover:text-zinc-300"
            )}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}

        <div className="flex-1" />

        {/* 项目筛选 */}
        <select value={activeProject} onChange={e => setActiveProject(e.target.value)}
          className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-300"
        >
          <option value="all">所有项目</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        <button onClick={loadData}
          className="p-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-400 hover:text-white transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* ════════════════════════════════════
          状态 TAB
         ════════════════════════════════════ */}
      {tab === 'status' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
          {/* ── 总览统计 ── */}
          {stats && (
            <div className="grid grid-cols-4 gap-4">
              <StatCard label="平台总数" value={stats.platforms} sub="backlink-platforms.yaml" icon={<Globe className="w-5 h-5 text-blue-400" />} color="bg-blue-500/10" />
              <StatCard label="待执行任务" value={stats.tasks.pending} sub={`运行中: ${stats.tasks.running}`} icon={<Clock className="w-5 h-5 text-yellow-400" />} color="bg-yellow-500/10" />
              <StatCard label="已提交" value={stats.submissions.total} sub={`成功: ${stats.submissions.success} | 付费墙: ${stats.submissions.paywall}`} icon={<FileText className="w-5 h-5 text-green-400" />} color="bg-green-500/10" />
              <StatCard label="外链资产" value={stats.assets.total} icon={<Link className="w-5 h-5 text-cyan-400" />} color="bg-cyan-500/10" />
            </div>
          )}

          {/* ── 项目概览 ── */}
          <div>
            <h3 className="text-lg font-bold text-white mb-4">项目概览</h3>
            <div className="grid grid-cols-2 gap-4">
              {projects.map(p => (
                <div key={p.id} className="bg-zinc-900/60 border border-zinc-800/50 rounded-xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h4 className="font-bold text-white">{p.name}</h4>
                      <p className="text-[11px] text-zinc-500">{p.domain} · {p.industry}</p>
                    </div>
                    <span className={cn(
                      "text-[10px] font-black px-2 py-1 rounded",
                      p.priority === 'P0' ? 'bg-red-500/10 text-red-400' : 'bg-zinc-800 text-zinc-500'
                    )}>{p.priority}</span>
                  </div>
                  <div className="grid grid-cols-5 gap-2 text-center">
                    {[
                      { label: '任务', value: p.stats.tasks, color: 'text-blue-400' },
                      { label: '待办', value: p.stats.pending, color: 'text-yellow-400' },
                      { label: '提交', value: p.stats.submitted, color: 'text-green-400' },
                      { label: '成功', value: p.stats.success, color: 'text-emerald-400' },
                      { label: '资产', value: p.stats.assets, color: 'text-cyan-400' },
                    ].map(s => (
                      <div key={s.label}>
                        <div className={cn("text-lg font-black", s.color)}>{s.value}</div>
                        <div className="text-[10px] text-zinc-600">{s.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── 任务队列 ── */}
          <div>
            <h3 className="text-lg font-bold text-white mb-4">任务队列</h3>
            <div className="bg-zinc-900/60 border border-zinc-800/50 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800/50">
                    <th className="text-left p-4 text-[11px] text-zinc-500 font-bold uppercase">平台</th>
                    <th className="text-left p-4 text-[11px] text-zinc-500 font-bold uppercase">项目</th>
                    <th className="text-left p-4 text-[11px] text-zinc-500 font-bold uppercase">DR</th>
                    <th className="text-left p-4 text-[11px] text-zinc-500 font-bold uppercase">难度</th>
                    <th className="text-left p-4 text-[11px] text-zinc-500 font-bold uppercase">状态</th>
                    <th className="text-left p-4 text-[11px] text-zinc-500 font-bold uppercase">结果</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.length === 0 ? (
                    <tr><td colSpan={6} className="p-8 text-center text-zinc-600">暂无任务</td></tr>
                  ) : tasks.slice(0, 20).map(t => (
                    <tr key={t.id} className="border-b border-zinc-800/30 hover:bg-zinc-800/30 transition-colors">
                      <td className="p-4 font-medium text-white">{t.platform_name}</td>
                      <td className="p-4 text-zinc-400">{t.project_id}</td>
                      <td className="p-4"><span className="text-blue-400 font-bold">{t.platform_dr}</span></td>
                      <td className="p-4">
                        <span className={cn(
                          "text-[11px] font-semibold",
                          t.platform_difficulty === 'easy' ? 'text-green-400' :
                          t.platform_difficulty === 'medium' ? 'text-yellow-400' : 'text-red-400'
                        )}>{t.platform_difficulty}</span>
                      </td>
                      <td className="p-4"><StatusBadge status={t.status} /></td>
                      <td className="p-4 text-zinc-500 text-[11px]">{t.result || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── 最近提交 ── */}
          <div>
            <h3 className="text-lg font-bold text-white mb-4">最近提交记录</h3>
            <div className="bg-zinc-900/60 border border-zinc-800/50 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800/50">
                    <th className="text-left p-4 text-[11px] text-zinc-500 font-bold uppercase">平台</th>
                    <th className="text-left p-4 text-[11px] text-zinc-500 font-bold uppercase">项目</th>
                    <th className="text-left p-4 text-[11px] text-zinc-500 font-bold uppercase">目标</th>
                    <th className="text-left p-4 text-[11px] text-zinc-500 font-bold uppercase">状态</th>
                    <th className="text-left p-4 text-[11px] text-zinc-500 font-bold uppercase">提交时间</th>
                    <th className="text-left p-4 text-[11px] text-zinc-500 font-bold uppercase">外链</th>
                  </tr>
                </thead>
                <tbody>
                  {submissions.length === 0 ? (
                    <tr><td colSpan={6} className="p-8 text-center text-zinc-600">暂无提交记录</td></tr>
                  ) : submissions.map(s => (
                    <tr key={s.id} className="border-b border-zinc-800/30 hover:bg-zinc-800/30 transition-colors">
                      <td className="p-4 font-medium text-white">{s.platform_id}</td>
                      <td className="p-4 text-zinc-400">{s.project_id}</td>
                      <td className="p-4 text-zinc-400 text-[11px]">{s.target_url}</td>
                      <td className="p-4"><StatusBadge status={s.status} /></td>
                      <td className="p-4 text-zinc-500 text-[11px]">
                        {s.submitted_at ? new Date(s.submitted_at * 1000).toLocaleDateString() : '-'}
                      </td>
                      <td className="p-4">
                        {s.link_url ? (
                          <a href={s.link_url} target="_blank" rel="noopener noreferrer"
                            className="text-blue-400 hover:text-blue-300 flex items-center gap-1 text-[11px]"
                          >
                            <ExternalLink className="w-3 h-3" /> 查看
                          </a>
                        ) : (
                          <span className="text-zinc-600 text-[11px]">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}

      {/* ════════════════════════════════════
          行动 TAB
         ════════════════════════════════════ */}
      {tab === 'actions' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
          <div className="grid grid-cols-3 gap-6">
            {/* 生成任务 */}
            <button onClick={() => runAction('schedule', '/api/backlinks/action/schedule')}
              disabled={actionLoading === 'schedule'}
              className="bg-zinc-900/60 border border-zinc-800/50 rounded-xl p-6 text-left hover:border-zinc-700/50 transition-all disabled:opacity-50 group"
            >
              <div className="p-3 bg-blue-500/10 rounded-lg w-fit mb-4 group-hover:scale-110 transition-transform">
                <FileText className="w-6 h-6 text-blue-400" />
              </div>
              <h3 className="font-bold text-white text-lg mb-2">生成任务</h3>
              <p className="text-zinc-500 text-sm mb-4">扫描平台库，按项目筛选可用平台，生成提交任务队列</p>
              <span className="text-blue-400 text-sm font-semibold flex items-center gap-2">
                {actionLoading === 'schedule' ? <><Loader2 className="w-4 h-4 animate-spin" /> 运行中...</> : '▶ 运行'}
              </span>
            </button>

            {/* 执行提交 */}
            <button onClick={() => runAction('execute', '/api/backlinks/action/execute')}
              disabled={actionLoading === 'execute'}
              className="bg-zinc-900/60 border border-zinc-800/50 rounded-xl p-6 text-left hover:border-zinc-700/50 transition-all disabled:opacity-50 group"
            >
              <div className="p-3 bg-green-500/10 rounded-lg w-fit mb-4 group-hover:scale-110 transition-transform">
                <Play className="w-6 h-6 text-green-400" />
              </div>
              <h3 className="font-bold text-white text-lg mb-2">执行提交</h3>
              <p className="text-zinc-500 text-sm mb-4">通过 Chrome CDP 自动打开提交页面，填写表单，检测结果</p>
              <span className={cn(
                "text-sm font-semibold flex items-center gap-2",
                actionLoading === 'execute' ? 'text-green-400' : 'text-green-400'
              )}>
                {actionLoading === 'execute' ? <><Loader2 className="w-4 h-4 animate-spin" /> 运行中（后台）</> : '▶ 启动'}
              </span>
            </button>

            {/* 巡检外链 */}
            <button onClick={() => runAction('check', '/api/backlinks/action/check')}
              disabled={actionLoading === 'check'}
              className="bg-zinc-900/60 border border-zinc-800/50 rounded-xl p-6 text-left hover:border-zinc-700/50 transition-all disabled:opacity-50 group"
            >
              <div className="p-3 bg-cyan-500/10 rounded-lg w-fit mb-4 group-hover:scale-110 transition-transform">
                <Search className="w-6 h-6 text-cyan-400" />
              </div>
              <h3 className="font-bold text-white text-lg mb-2">巡检外链</h3>
              <p className="text-zinc-500 text-sm mb-4">检查已提交外链是否被 Google 收录、链接是否存活</p>
              <span className="text-cyan-400 text-sm font-semibold flex items-center gap-2">
                {actionLoading === 'check' ? <><Loader2 className="w-4 h-4 animate-spin" /> 运行中...</> : '▶ 运行'}
              </span>
            </button>
          </div>

          {/* ── 运行日志 ── */}
          <div>
            <h3 className="text-lg font-bold text-white mb-4">运行日志</h3>
            <div className="bg-zinc-900/80 border border-zinc-800/50 rounded-xl p-4 max-h-64 overflow-y-auto font-mono text-[11px] leading-relaxed">
              {actionLog.length === 0 ? (
                <span className="text-zinc-600">点击上方按钮开始操作</span>
              ) : actionLog.map((line, i) => (
                <div key={i} className={cn(
                  "py-0.5",
                  line.startsWith('✅') ? 'text-green-400' :
                  line.startsWith('❌') ? 'text-red-400' :
                  line.startsWith('>') ? 'text-blue-400' : 'text-zinc-400'
                )}>{line}</div>
              ))}
            </div>
          </div>

          {/* ── 使用提示 ── */}
          <div className="bg-zinc-900/60 border border-zinc-800/50 rounded-xl p-5">
            <h3 className="font-bold text-white mb-2">💡 工作流程</h3>
            <ol className="text-zinc-400 text-sm space-y-2 list-decimal list-inside">
              <li><span className="text-white">生成任务</span> → 调度器扫描所有可用平台，为每个项目生成提交任务</li>
              <li><span className="text-white">执行提交</span> → Worker 逐一处理，自动填表→检测结果→记录数据库</li>
              <li><span className="text-white">巡检外链</span> → 检查已提交外链的收录和存活状态</li>
            </ol>
            <p className="text-zinc-600 text-xs mt-3">前提：Chrome CDP 端口 9222 已开启（harvests-engine 启动时自动打开）</p>
          </div>
        </motion.div>
      )}

      {/* ════════════════════════════════════
          结果 TAB
         ════════════════════════════════════ */}
      {tab === 'results' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
          {/* ── 成功率统计 ── */}
          {stats && (
            <div className="grid grid-cols-4 gap-4">
              <StatCard label="成功率" value={stats.submissions.total > 0
                ? Math.round(stats.submissions.success / stats.submissions.total * 100) + '%'
                : '-'}
                sub={`${stats.submissions.success}/${stats.submissions.total}`}
                icon={<Activity className="w-5 h-5 text-green-400" />} color="bg-green-500/10" />
              <StatCard label="付费墙拦截" value={stats.submissions.paywall} icon={<AlertTriangle className="w-5 h-5 text-orange-400" />} color="bg-orange-500/10" />
              <StatCard label="验证码拦截" value={stats.submissions.captcha} icon={<Shield className="w-5 h-5 text-purple-400" />} color="bg-purple-500/10" />
              <StatCard label="外链资产" value={stats.assets.total} sub={stats.assets.indexed > 0 ? `${stats.assets.indexed} 已收录` : undefined} icon={<Link className="w-5 h-5 text-cyan-400" />} color="bg-cyan-500/10" />
            </div>
          )}

          {/* ── 平台成功率排名 ── */}
          <div>
            <h3 className="text-lg font-bold text-white mb-4">平台分析</h3>
            <div className="bg-zinc-900/60 border border-zinc-800/50 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800/50">
                    <th className="text-left p-4 text-[11px] text-zinc-500 font-bold uppercase">平台</th>
                    <th className="text-left p-4 text-[11px] text-zinc-500 font-bold uppercase">DR</th>
                    <th className="text-left p-4 text-[11px] text-zinc-500 font-bold uppercase">难度</th>
                    <th className="text-left p-4 text-[11px] text-zinc-500 font-bold uppercase">提交次数</th>
                    <th className="text-left p-4 text-[11px] text-zinc-500 font-bold uppercase">成功</th>
                    <th className="text-left p-4 text-[11px] text-zinc-500 font-bold uppercase">付费墙</th>
                    <th className="text-left p-4 text-[11px] text-zinc-500 font-bold uppercase">验证码</th>
                  </tr>
                </thead>
                <tbody>
                  {/* 从 submissions 聚合统计 */}
                  {Array.from(new Set(submissions.map(s => s.platform_id))).slice(0, 20).map(platformId => {
                    const platformSubs = submissions.filter(s => s.platform_id === platformId);
                    const succ = platformSubs.filter(s => s.status === 'success' || s.status === 'pending_review').length;
                    const pw = platformSubs.filter(s => s.status === 'paywall').length;
                    const cap = platformSubs.filter(s => s.status === 'captcha').length;
                    return (
                      <tr key={platformId} className="border-b border-zinc-800/30 hover:bg-zinc-800/30 transition-colors">
                        <td className="p-4 font-medium text-white">{platformId}</td>
                        <td className="p-4 text-blue-400 font-bold">-</td>
                        <td className="p-4 text-zinc-500">-</td>
                        <td className="p-4 text-zinc-300">{platformSubs.length}</td>
                        <td className="p-4"><span className="text-green-400">{succ}</span></td>
                        <td className="p-4"><span className="text-orange-400">{pw}</span></td>
                        <td className="p-4"><span className="text-purple-400">{cap}</span></td>
                      </tr>
                    );
                  })}
                  {submissions.length === 0 && (
                    <tr><td colSpan={7} className="p-8 text-center text-zinc-600">暂无数据</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
