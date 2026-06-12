import React, { useState, useMemo, useEffect } from 'react';
import {
  TrendingUp,
  Users,
  MessageSquare,
  Instagram,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  Brain,
  ChevronRight,
  Zap,
  Box,
  ShoppingCart,
  AlertTriangle,
  Flame,
  Sparkles,
  CheckCircle2,
  Loader2,
  Settings,
  MapPin,
  Send,
  MessageCircle,
  Target,
  BarChart3,
  RefreshCw,
  Bot,
  Image
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../lib/utils';
import { useCRM } from '../contexts/CRMContext';
import { generatePersonaDMScript } from '../lib/gemini';
import { toast } from 'sonner';

const data = [
  { name: 'Mon', engagement: 400, conversions: 24 },
  { name: 'Tue', engagement: 300, conversions: 13 },
  { name: 'Wed', engagement: 200, conversions: 98 },
  { name: 'Thu', engagement: 278, conversions: 39 },
  { name: 'Fri', engagement: 189, conversions: 48 },
  { name: 'Sat', engagement: 239, conversions: 38 },
  { name: 'Sun', engagement: 349, conversions: 43 },
];

const StatCard = ({ title, value, change, icon: Icon, trend }: any) => (
  <div className="bg-[#111] border border-zinc-800/50 p-6 rounded-2xl">
    <div className="flex items-center justify-between mb-4">
      <div className="w-10 h-10 bg-zinc-900 rounded-xl flex items-center justify-center border border-zinc-800/50">
        <Icon className="w-5 h-5 text-rose-500" />
      </div>
      <div className={`flex items-center gap-1 text-xs font-medium ${trend === 'up' ? 'text-green-500' : 'text-rose-500'}`}>
        {trend === 'up' ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
        {change}
      </div>
    </div>
    <p className="text-zinc-500 text-sm font-medium mb-1">{title}</p>
    <h3 className="text-2xl font-bold tracking-tight">{value}</h3>
  </div>
);

const inventoryAlerts = [
  { item: 'Dynamic Black Ink (8oz)', sku: 'DB-8OZ', stock: 0, requestedBy: 'Alex Rivera' },
  { item: 'Bishop Wand Power Supply', sku: 'BW-PS-01', stock: 2, requestedBy: 'Sarah Chen' },
];

export default function Dashboard({ onNavigate }: { onNavigate?: (tab: any) => void }) {
  const { artists, persona, conversionDNA, harvestList, refreshHarvestList, isScanning, setIsScanning, isRefreshing, scanProgress, pinnedCount } = useCRM();
  const [generatingFor, setGeneratingFor] = React.useState<string | null>(null);
  const [generatedScript, setGeneratedScript] = React.useState<{ id: string, text: string } | null>(null);

  // DM & Bot Stats (15)
  const [dmStats, setDmStats] = useState<Record<string, number>>({});
  const [dmConversionRate, setDmConversionRate] = useState(0);
  const [botDaily, setBotDaily] = useState<any[]>([]);
  const [onlineBots, setOnlineBots] = useState(0);
  const [scriptLibCount, setScriptLibCount] = useState(0);
  const [statsLoading, setStatsLoading] = useState(false);

  // Content Pipeline (17)
  const [contentQueue, setContentQueue] = useState<any[]>([]);
  const [generatingContent, setGeneratingContent] = useState(false);
  const [contentGenResult, setContentGenResult] = useState<{ generated: number; skipped: number } | null>(null);

  // Pending Media (25)
  const [pendingMediaTasks, setPendingMediaTasks] = useState<any[]>([]);
  const [mediaFileInputs, setMediaFileInputs] = useState<Record<string, string>>({});

  // Bot Health (26)
  const [botHealth, setBotHealth] = useState<{ total: number; online: number; offline: number; paused: number; criticalAlerts: number; warningAlerts: number; bots: any[] } | null>(null);

  // A/B Testing (27)
  const [abTestData, setAbTestData] = useState<any[]>([]);
  const [optimizing, setOptimizing] = useState(false);

  // CRM Funnel (18)
  const crmFunnel = useMemo(() => {
    const total = artists.length || 1;
    const stages = ['lead', 'warm', 'engaged', 'connected', 'customer'];
    const counts = stages.map(s => ({ stage: s, count: artists.filter(a => a.stage === s).length }));
    return { total: artists.length, stages: counts };
  }, [artists]);

  const loadDashboardStats = async () => {
    setStatsLoading(true);
    try {
      const [statsRes, scriptsRes, tasksRes] = await Promise.all([
        fetch('/api/bot/stats/dashboard?days=14'),
        fetch('/api/marketing/scripts?active=true'),
        fetch('/api/marketing/tasks/stats')
      ]);
      if (statsRes.ok) {
        const d = await statsRes.json();
        setBotDaily(Array.isArray(d?.daily) ? d.daily : []);
        setOnlineBots(d?.online || 0);
        if (d?.funnel) {
          setDmStats({ sent: d.funnel.dmsSent, replied: d.funnel.dmsReplied, converted: d.funnel.dmsConverted });
          setDmConversionRate(d.funnel.conversionRate);
        }
      }
      if (scriptsRes.ok) {
        const s = await scriptsRes.json();
        setScriptLibCount(s?.total || 0);
      }
      if (tasksRes.ok) {
        const t = await tasksRes.json();
        setDmStats(prev => ({ ...prev, pending: t?.counts?.pending || 0 }));
      }
    } finally {
      setStatsLoading(false);
    }
  };

  useEffect(() => {
    void loadDashboardStats();
    void loadPendingMedia();
    void loadBotHealth();
    void loadAbTestData();
  }, []);

  const loadPendingMedia = async () => {
    try {
      const res = await fetch('/api/publish/tasks/pending-media');
      if (res.ok) {
        const data = await res.json();
        setPendingMediaTasks(Array.isArray(data?.tasks) ? data.tasks : []);
      }
    } catch {}
  };

  const loadBotHealth = async () => {
    try {
      const res = await fetch('/api/bot/health');
      if (res.ok) setBotHealth(await res.json());
    } catch {}
  };

  const loadAbTestData = async () => {
    try {
      const res = await fetch('/api/marketing/scripts/ab-test');
      if (res.ok) {
        const d = await res.json();
        setAbTestData(Array.isArray(d?.categories) ? d.categories : []);
      }
    } catch {}
  };

  const autoOptimize = async () => {
    setOptimizing(true);
    try {
      const res = await fetch('/api/marketing/scripts/auto-optimize', { method: 'POST' });
      if (res.ok) {
        const d = await res.json();
        toast.success(d.changed?.[0] || 'Optimized');
        void loadAbTestData();
      }
    } catch { toast.error('Auto-optimize failed'); }
    finally { setOptimizing(false); }
  };

  const attachMedia = async (taskId: string) => {
    const input = mediaFileInputs[taskId];
    if (!input || !input.trim()) { toast.error('Enter at least one file path'); return; }
    const files = input.split('\n').map(s => s.trim()).filter(s => s.length > 0);
    if (files.length === 0) { toast.error('Enter at least one file path'); return; }
    try {
      const res = await fetch(`/api/publish/tasks/${taskId}/attach-media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mediaFiles: files })
      });
      if (res.ok) {
        toast.success(`Media attached to ${taskId.slice(0, 20)}`);
        setMediaFileInputs(prev => { const next = { ...prev }; delete next[taskId]; return next; });
        void loadPendingMedia();
        // Also refresh content queue
        const qRes = await fetch('/api/content/pipeline/queue');
        if (qRes.ok) { const q = await qRes.json(); setContentQueue(Array.isArray(q?.tasks) ? q.tasks : []); }
      } else {
        const err = await res.json();
        toast.error(err?.error || 'Failed to attach media');
      }
    } catch { toast.error('Failed to attach media'); }
  };

  const stats = useMemo(() => {
    const totalLeads = artists.length;
    const customers = artists.filter(a => a.stage === 'customers').length;
    const dormant = artists.filter(a => a.stage === 'dormant').length;
    const conversionRate = totalLeads > 0 ? ((customers / totalLeads) * 100).toFixed(1) : '0.0';
    const highIntent = artists.filter(a => a.isHighIntent).length;
    const activeCampaigns = artists.filter(a => a.stage === 'active' || a.stage === 'engaged').length;

    return [
      { label: 'Total Leads', value: totalLeads.toLocaleString(), change: '+12%', trend: 'up', icon: Users, color: 'text-blue-500' },
      { label: 'Conversion Rate', value: `${conversionRate}%`, change: '+0.8%', trend: 'up', icon: TrendingUp, color: 'text-green-500' },
      { label: 'Dormant Leads', value: dormant.toString(), change: '+3', trend: 'down', icon: Clock, color: 'text-zinc-500' },
      { label: 'High Intent', value: highIntent.toString(), change: '+5', trend: 'up', icon: Flame, color: 'text-rose-500' },
    ];
  }, [artists]);

  const dmFunnelStats = useMemo(() => [
    { label: 'DM Pending', value: String(dmStats.pending || 0), icon: Clock, color: 'text-amber-500', bg: 'bg-amber-500/10' },
    { label: 'DM Sent', value: String(dmStats.sent || 0), icon: Send, color: 'text-blue-500', bg: 'bg-blue-500/10' },
    { label: 'DM Replied', value: String(dmStats.replied || 0), icon: MessageCircle, color: 'text-purple-500', bg: 'bg-purple-500/10' },
    { label: 'DM Converted', value: String(dmStats.converted || 0), icon: Target, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
  ], [dmStats]);

  const dailyTotals = useMemo(() => {
    if (!botDaily.length) return { followers: 0, likes: 0, comments: 0 };
    return {
      followers: botDaily.reduce((s, d) => s + (d.followersGained || 0), 0),
      likes: botDaily.reduce((s, d) => s + (d.likes || 0), 0),
      comments: botDaily.reduce((s, d) => s + (d.comments || 0), 0),
      dms: botDaily.reduce((s, d) => s + (d.dmsSent || 0), 0),
    };
  }, [botDaily]);

  const handleGenerateScript = async (artist: any) => {
    setGeneratingFor(artist.id);
    try {
      const script = await generatePersonaDMScript(artist.fullName, artist.dnaTags, persona);
      setGeneratedScript({ id: artist.id, text: script });
      toast.success(`AI Script generated for @${artist.username}`);
    } catch (error) {
      toast.error('Failed to generate script');
    } finally {
      setGeneratingFor(null);
    }
  };

  return (
    <div className="space-y-8">
      {isScanning && (
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-rose-600/10 border border-rose-500/30 p-4 rounded-2xl flex flex-col gap-3"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Loader2 className="w-5 h-5 text-rose-500 animate-spin" />
              <p className="text-sm font-black text-rose-100">
                {scanProgress.total > 0 
                  ? `Processing: ${scanProgress.current} / ${scanProgress.total} leads...`
                  : `Scanning 52,000 artists based on conversion model... ${pinnedCount} high-match targets pinned for you.`
                }
              </p>
              {scanProgress.total > 0 && (
                <button 
                  onClick={() => setIsScanning(false)}
                  className="px-2 py-0.5 bg-rose-600/20 hover:bg-rose-600/40 border border-rose-500/30 rounded text-[9px] font-black uppercase tracking-widest text-rose-400 transition-all ml-2"
                >
                  Stop Scan
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-1 bg-rose-600 text-[10px] font-black rounded-lg uppercase tracking-widest">
                {scanProgress.total > 0 ? 'Importing' : 'Scanning'}
              </span>
            </div>
          </div>
          {scanProgress.total > 0 && (
            <div className="w-full h-1.5 bg-zinc-900 rounded-full overflow-hidden">
              <motion.div 
                className="h-full bg-rose-500"
                initial={{ width: 0 }}
                animate={{ width: `${(scanProgress.current / scanProgress.total) * 100}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
          )}
        </motion.div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, i) => {
          const Icon = stat.icon;
          return (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className="bg-[#111] border border-zinc-800/50 p-6 rounded-3xl hover:border-rose-500/30 transition-all group"
            >
              <div className="flex items-center justify-between mb-4">
                <div className={cn("p-3 rounded-2xl bg-zinc-900 border border-zinc-800 group-hover:scale-110 transition-transform", stat.color)}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className={cn(
                  "flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-lg",
                  stat.trend === 'up' ? "bg-green-500/10 text-green-500" : "bg-rose-500/10 text-rose-500"
                )}>
                  {stat.trend === 'up' ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                  {stat.change}
                </div>
              </div>
              <h3 className="text-zinc-500 text-sm font-medium mb-1">{stat.label}</h3>
              <p className="text-2xl font-bold tracking-tight">{stat.value}</p>
            </motion.div>
          );
        })}
      </div>

      {/* DM Funnel Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {dmFunnelStats.map((stat, i) => {
          const Icon = stat.icon;
          return (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              className="bg-[#111] border border-zinc-800/50 p-5 rounded-2xl"
            >
              <div className="flex items-center gap-3 mb-3">
                <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center", stat.bg)}>
                  <Icon className={cn("w-4 h-4", stat.color)} />
                </div>
                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">{stat.label}</span>
              </div>
              <p className="text-2xl font-bold tracking-tight">{stat.value}</p>
            </motion.div>
          );
        })}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.32 }}
          className="bg-gradient-to-r from-rose-600/10 to-amber-600/10 border border-rose-500/20 p-5 rounded-2xl flex items-center justify-between"
        >
          <div>
            <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">DM Conv. Rate</span>
            <p className="text-2xl font-bold tracking-tight mt-1">{dmConversionRate}%</p>
          </div>
          <div className="text-right">
            <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Scripts</span>
            <p className="text-lg font-bold mt-1">{scriptLibCount}</p>
          </div>
        </motion.div>
      </div>

      {/* Conversion DNA Section */}
      {conversionDNA && (
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-r from-rose-600/20 to-amber-600/20 border border-rose-500/30 p-8 rounded-[2.5rem] relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 w-64 h-64 bg-rose-500/10 blur-[80px] -mr-32 -mt-32 rounded-full" />
          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-8">
            <div className="flex items-center gap-5">
              <div className="w-14 h-14 bg-rose-600 rounded-2xl flex items-center justify-center shadow-lg shadow-rose-600/20">
                <Brain className="w-8 h-8 text-white" />
              </div>
              <div>
                <h3 className="text-xl font-black text-white flex items-center gap-3">
                  Conversion DNA Extracted
                  <span className="px-2 py-1 bg-rose-600 text-[10px] font-black rounded-full animate-pulse">LIVE EVOLUTION</span>
                </h3>
                <p className="text-rose-200/60 text-sm font-medium">System has analyzed your top customers to refine outreach targeting.</p>
              </div>
            </div>
            
            <div className="flex flex-wrap gap-4">
              <div className="px-4 py-2 bg-black/40 border border-white/10 rounded-xl">
                <p className="text-[10px] font-black text-rose-400 uppercase tracking-widest mb-1">Top Styles</p>
                <p className="text-sm font-bold text-white">{conversionDNA.topStyles.join(', ')}</p>
              </div>
              <div className="px-4 py-2 bg-black/40 border border-white/10 rounded-xl">
                <p className="text-[10px] font-black text-rose-400 uppercase tracking-widest mb-1">Hot Regions</p>
                <p className="text-sm font-bold text-white">{conversionDNA.topLocations.join(', ')}</p>
              </div>
              <div className="px-4 py-2 bg-black/40 border border-white/10 rounded-xl">
                <p className="text-[10px] font-black text-rose-400 uppercase tracking-widest mb-1">Avg. Followers</p>
                <p className="text-sm font-bold text-white">{Math.round(conversionDNA.avgFollowers).toLocaleString()}</p>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Bot Activity Stats & DM Pipeline */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-3 bg-[#111] border border-zinc-800/50 p-6 rounded-[2rem]">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <BarChart3 className="w-5 h-5 text-rose-500" />
              <h4 className="font-black text-sm">Bot Activity (14d)</h4>
            </div>
            <div className="flex items-center gap-3 text-[10px] font-black text-zinc-500">
              <span>Followers: <strong className="text-emerald-400">+{dailyTotals.followers}</strong></span>
              <span>Likes: <strong className="text-blue-400">{dailyTotals.likes}</strong></span>
              <span>Comments: <strong className="text-amber-400">{dailyTotals.comments}</strong></span>
              <button onClick={() => void loadDashboardStats()} className="p-1.5 hover:bg-zinc-800 rounded-lg transition-colors">
                <RefreshCw className={cn("w-3.5 h-3.5", statsLoading && "animate-spin")} />
              </button>
            </div>
          </div>
          {botDaily.length > 0 ? (
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={botDaily}>
                <CartesianGrid strokeDasharray="3 3" stroke="#222" />
                <XAxis dataKey="date" tick={{ fill: '#555', fontSize: 10 }} tickFormatter={(v) => v?.slice(5) || ''} />
                <Tooltip
                  contentStyle={{ background: '#18181b', border: '1px solid #27272a', borderRadius: 12, fontSize: 12 }}
                  labelStyle={{ color: '#e4e4e7' }}
                />
                <Area type="monotone" dataKey="followersGained" stroke="#34d399" fill="#34d399" fillOpacity={0.1} strokeWidth={2} name="Followers" />
                <Area type="monotone" dataKey="likes" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.1} strokeWidth={2} name="Likes" />
                <Area type="monotone" dataKey="comments" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.1} strokeWidth={2} name="Comments" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[160px] flex items-center justify-center text-zinc-600 text-xs font-medium">No bot activity data yet</div>
          )}
        </div>

        <div className="bg-[#111] border border-zinc-800/50 p-6 rounded-[2rem] flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-3 mb-4">
              <Bot className="w-5 h-5 text-cyan-500" />
              <h4 className="font-black text-sm">Bot Network</h4>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between items-center p-3 bg-zinc-900/50 rounded-xl border border-zinc-800/50">
                <span className="text-xs text-zinc-400">Online</span>
                <span className="text-lg font-black text-green-400">{onlineBots}</span>
              </div>
              <div className="flex justify-between items-center p-3 bg-zinc-900/50 rounded-xl border border-zinc-800/50">
                <span className="text-xs text-zinc-400">DM Conv.</span>
                <span className="text-lg font-black text-emerald-400">{dmConversionRate}%</span>
              </div>
              <div className="flex justify-between items-center p-3 bg-zinc-900/50 rounded-xl border border-zinc-800/50">
                <span className="text-xs text-zinc-400">Scripts</span>
                <span className="text-lg font-black text-rose-400">{scriptLibCount}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Today's Harvest List */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-[#111] border border-zinc-800/50 rounded-[2.5rem] overflow-hidden">
            <div className="p-8 border-b border-zinc-800/50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-amber-600/10 rounded-2xl flex items-center justify-center border border-amber-500/20">
                  <Flame className="w-6 h-6 text-amber-500" />
                </div>
                <div>
                  <h4 className="font-black text-xl text-white">Today's Harvest List</h4>
                  <p className="text-zinc-500 text-xs font-medium">Top 50 leads ranked by heat and weighted conversion similarity.</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button 
                  onClick={refreshHarvestList}
                  disabled={isRefreshing}
                  className="px-4 py-2 bg-zinc-900 border border-zinc-800 hover:border-rose-500/50 text-zinc-400 hover:text-rose-500 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2"
                >
                  {isRefreshing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Clock className="w-3 h-3" />}
                  Refresh Weights
                </button>
                <div className="flex items-center gap-2 px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-xl">
                  <Users className="w-4 h-4 text-zinc-500" />
                  <span className="text-xs font-black text-zinc-300">{harvestList.length} Leads</span>
                </div>
              </div>
            </div>
            
            <div className="divide-y divide-zinc-800/50 max-h-[600px] overflow-y-auto scrollbar-hide">
              {harvestList.map((artist, i) => (
                <motion.div 
                  key={artist.id} 
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="p-6 hover:bg-zinc-900/30 transition-colors group"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="relative">
                        <img 
                          src={artist.profilePic} 
                          alt={artist.username} 
                          className="w-14 h-14 rounded-2xl border border-zinc-800 object-cover"
                          referrerPolicy="no-referrer"
                        />
                        {artist.isHighIntent && (
                          <div className="absolute -top-2 -right-2 w-6 h-6 bg-red-600 rounded-full flex items-center justify-center border-2 border-[#111] animate-bounce">
                            <Flame className="w-3 h-3 text-white" />
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h5 className="font-black text-white">
                            @{(!artist.username || artist.username.startsWith('user_')) ? (artist.fullName || 'artist').toLowerCase().replace(/\s+/g, '_') : artist.username}
                          </h5>
                          {artist.stage === 'dormant' && (
                            <span className="px-2 py-0.5 bg-rose-500/10 text-[8px] font-black rounded-full text-rose-500 uppercase tracking-widest border border-rose-500/20">
                              Dormant
                            </span>
                          )}
                          {artist.hasFollowedBack && artist.stage === 'outreach' && (
                            <span className="px-2 py-0.5 bg-green-500/10 text-[8px] font-black rounded-full text-green-500 uppercase tracking-widest border border-green-500/20 animate-pulse">
                              Just Followed Back
                            </span>
                          )}
                          {artist.customerTier && (
                            <span className={cn(
                              "px-2 py-0.5 text-[8px] font-black rounded-full uppercase tracking-widest border",
                              artist.customerTier === 'vip' ? "bg-amber-500/10 text-amber-500 border-amber-500/20" :
                              artist.customerTier === 'loyal' ? "bg-blue-500/10 text-blue-500 border-blue-500/20" :
                              "bg-zinc-800 text-zinc-400 border-zinc-700"
                            )}>
                              {artist.customerTier}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-col gap-0.5 mt-1">
                          <p className="text-[10px] text-zinc-400 font-bold">{artist.fullName || 'Unknown Shop'}</p>
                          <div className="flex items-center gap-3">
                            <span className="text-[10px] text-zinc-500 font-bold flex items-center gap-1">
                              <MapPin className="w-3 h-3 text-zinc-600" />
                              {artist.location || 'No Location'}{artist.country ? `, ${artist.country}` : ''}
                            </span>
                            <span className="text-[10px] text-rose-500/80 font-black flex items-center gap-1">
                              <Users className="w-3 h-3" />
                              {artist.followers ? artist.followers.toLocaleString() : '0'}
                            </span>
                            <span className="text-[10px] text-blue-400 font-bold flex items-center gap-1">
                              <Sparkles className="w-3 h-3 text-blue-500" />
                              {artist.style || 'Various'}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 mt-2">
                          <div className="flex items-center gap-1">
                            <Zap className="w-3 h-3 text-rose-500" />
                            <span className="text-[10px] font-black text-zinc-400">Heat: {artist.heatScore}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Brain className="w-3 h-3 text-blue-500" />
                            <span className="text-[10px] font-black text-zinc-400">Similarity: {artist.similarityScore}%</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-3">
                      <button 
                        onClick={() => handleGenerateScript(artist)}
                        disabled={generatingFor === artist.id}
                        className={cn(
                          "px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2",
                          generatedScript?.id === artist.id 
                            ? "bg-green-600/10 text-green-500 border border-green-500/20"
                            : "bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/20"
                        )}
                      >
                        {generatingFor === artist.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : generatedScript?.id === artist.id ? (
                          <CheckCircle2 className="w-3 h-3" />
                        ) : (
                          <Sparkles className="w-3 h-3" />
                        )}
                        {generatedScript?.id === artist.id ? 'Script Ready' : 'Generate AI Script'}
                      </button>
                      
                      <AnimatePresence>
                        {generatedScript?.id === artist.id && (
                          <motion.div 
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            className="w-80 p-3 bg-zinc-900 border border-zinc-800 rounded-xl text-[10px] text-zinc-400 leading-relaxed relative"
                          >
                            <p className="italic">"{generatedScript.text}"</p>
                            <button 
                              onClick={() => {
                                navigator.clipboard.writeText(generatedScript.text);
                                toast.success('Copied to clipboard');
                              }}
                              className="absolute top-2 right-2 text-rose-500 hover:text-rose-400"
                            >
                              Copy
                            </button>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>

        {/* Inventory Alerts & Quick Actions */}
        <div className="lg:col-span-1 space-y-6">
          {/* AI Persona Card */}
          <div className="bg-[#111] border border-zinc-800/50 p-8 rounded-[2.5rem] relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-rose-600/5 blur-[40px] -mr-16 -mt-16 rounded-full" />
            <h4 className="font-black text-sm text-zinc-500 uppercase tracking-[0.2em] mb-6">Current AI Persona</h4>
            <div className="flex items-center gap-4 mb-6">
              <div className="w-16 h-16 bg-rose-600/10 rounded-2xl flex items-center justify-center border border-rose-500/20">
                <Brain className="w-8 h-8 text-rose-500" />
              </div>
              <div>
                <p className="text-xl font-black text-white capitalize">{persona}</p>
                <p className="text-xs text-zinc-500 font-medium">
                  {persona === 'professional' ? 'Expert & Authoritative' : 'Friendly & Peer-like'}
                </p>
              </div>
            </div>
            <button className="w-full py-4 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 text-xs font-black rounded-2xl transition-all flex items-center justify-center gap-2">
              <Settings className="w-4 h-4" />
              Change Persona in Settings
            </button>
          </div>

          {/* Inventory Alerts */}
          <div className="bg-[#111] border border-zinc-800/50 p-6 rounded-3xl">
            <div className="flex items-center gap-3 mb-6">
              <Box className="w-5 h-5 text-amber-500" />
              <h4 className="font-bold">Inventory Alerts</h4>
            </div>
            <div className="space-y-4">
              {inventoryAlerts.map((alert, i) => (
                <div key={i} className="p-4 bg-zinc-900/50 border border-zinc-800 rounded-2xl space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-zinc-300">{alert.item}</span>
                    <span className={cn(
                      "text-[10px] font-bold px-2 py-0.5 rounded-full",
                      alert.stock === 0 ? "bg-rose-500/10 text-rose-500" : "bg-amber-500/10 text-amber-500"
                    )}>
                      {alert.stock === 0 ? 'Out of Stock' : `${alert.stock} Left`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                    <AlertTriangle className="w-3 h-3 text-amber-500" />
                    <span>Requested by {alert.requestedBy}</span>
                  </div>
                  <button className="w-full py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px] font-bold rounded-xl transition-all">
                    Suggest Alternative
                  </button>
                </div>
              ))}
            </div>
            <button 
              onClick={() => onNavigate?.('inventory')}
              className="mt-6 w-full py-4 bg-rose-600/10 hover:bg-rose-600/20 text-rose-500 border border-rose-500/20 text-xs font-black rounded-2xl transition-all flex items-center justify-center gap-2"
            >
              <Box className="w-4 h-4" />
              Manage Master Inventory
            </button>
          </div>
        </div>
      </div>

      {/* Content Pipeline & CRM Funnel */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Content Pipeline: Customer UGC → Publish */}
        <div className="bg-[#111] border border-zinc-800/50 p-6 rounded-[2rem]">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-emerald-500/10 rounded-xl flex items-center justify-center border border-emerald-500/20">
                <Zap className="w-5 h-5 text-emerald-500" />
              </div>
              <div>
                <h4 className="font-black text-sm text-white">Content Pipeline</h4>
                <p className="text-[10px] text-zinc-500">Customer UGC → Auto-publish</p>
              </div>
            </div>
          </div>

          <div className="bg-zinc-900/30 border border-zinc-800 rounded-xl p-4 mb-4">
            <p className="text-[10px] text-zinc-500 leading-relaxed">
              Generate publish tasks from <strong className="text-emerald-400">converted customers</strong> who follow-backed, bought products, and posted about them. Content is scheduled over 7 days.
            </p>
          </div>

          <div className="flex gap-3 mb-4">
            <button
              onClick={async () => {
                setGeneratingContent(true);
                setContentGenResult(null);
                try {
                  const res = await fetch('/api/content/pipeline/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ limit: 5 })
                  });
                  const data = await res.json();
                  setContentGenResult({ generated: data.generated || 0, skipped: data.skipped || 0 });
                  toast.success(`Generated ${data.generated} publish tasks`);
                  // Reload queue
                  const qRes = await fetch('/api/content/pipeline/queue');
                  if (qRes.ok) {
                    const q = await qRes.json();
                    setContentQueue(Array.isArray(q?.tasks) ? q.tasks : []);
                  }
                } catch {
                  toast.error('Content generation failed');
                } finally {
                  setGeneratingContent(false);
                }
              }}
              disabled={generatingContent}
              className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 text-white font-black rounded-xl text-xs transition-all flex items-center justify-center gap-2"
            >
              {generatingContent ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              {generatingContent ? 'Generating...' : 'Generate from Customers'}
            </button>
            <button
              onClick={async () => {
                const res = await fetch('/api/content/pipeline/queue');
                if (res.ok) {
                  const d = await res.json();
                  setContentQueue(Array.isArray(d?.tasks) ? d.tasks : []);
                }
              }}
              className="px-4 py-3 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-400 font-black rounded-xl text-xs transition-all"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          {contentGenResult && (
            <div className="flex gap-2 mb-3 text-[10px] font-bold">
              <span className="px-2 py-1 bg-emerald-500/10 text-emerald-400 rounded-lg">+{contentGenResult.generated} tasks created</span>
              {contentGenResult.skipped > 0 && <span className="px-2 py-1 bg-zinc-800 text-zinc-500 rounded-lg">{contentGenResult.skipped} skipped (duplicates)</span>}
            </div>
          )}

          <div className="max-h-32 overflow-y-auto space-y-1.5">
            {contentQueue.length === 0 ? (
              <p className="text-xs text-zinc-600 text-center py-4 font-medium">No pending publish tasks. Click generate to create from customer content.</p>
            ) : contentQueue.slice(0, 10).map((t: any) => (
              <div key={t.id} className="flex items-center justify-between p-2 bg-zinc-900/50 border border-zinc-800 rounded-lg">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                  <span className="text-[10px] text-zinc-400 truncate">{t.caption}</span>
                </div>
                <span className="text-[9px] text-zinc-600 flex-shrink-0 ml-2">{new Date(t.scheduledAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>

        {/* CRM Funnel */}
        <div className="bg-[#111] border border-zinc-800/50 p-6 rounded-[2rem]">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 bg-rose-500/10 rounded-xl flex items-center justify-center border border-rose-500/20">
              <Target className="w-5 h-5 text-rose-500" />
            </div>
            <div>
              <h4 className="font-black text-sm text-white">CRM Lifecycle Funnel</h4>
              <p className="text-[10px] text-zinc-500">{crmFunnel.total} total leads</p>
            </div>
          </div>
          <div className="space-y-2">
            {crmFunnel.stages.map((s, i) => {
              const pct = crmFunnel.total > 0 ? Math.round((s.count / crmFunnel.total) * 100) : 0;
              const colors = ['bg-zinc-700', 'bg-blue-500', 'bg-amber-500', 'bg-purple-500', 'bg-emerald-500'];
              const labels = ['Lead', 'Warm', 'Engaged', 'Connected', 'Customer'];
              return (
                <div key={s.stage} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-zinc-300 flex items-center gap-2">
                      <div className={cn("w-2 h-2 rounded-full", colors[i])} />
                      {labels[i]}
                    </span>
                    <span className="text-zinc-500">{s.count} ({pct}%)</span>
                  </div>
                  <div className="w-full h-2 bg-zinc-900 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      className={cn("h-full rounded-full transition-all", colors[i])}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4 pt-4 border-t border-zinc-800/50 text-[10px] text-zinc-600">
            <p>Stage advances automatically: DM sent → <strong className="text-blue-400">Warm</strong>, replied → <strong className="text-amber-400">Engaged</strong>, converted → <strong className="text-emerald-400">Customer</strong>. Inbound: follow/like → <strong className="text-blue-400">Warm</strong>, comment on our posts → <strong className="text-amber-400">Engaged</strong></p>
          </div>
        </div>
      </div>

      {/* Pending Media Section */}
      {pendingMediaTasks.length > 0 && (
        <div className="bg-[#111] border border-amber-500/30 p-6 rounded-[2rem]">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-500/10 rounded-xl flex items-center justify-center border border-amber-500/20">
                <Image className="w-5 h-5 text-amber-500" />
              </div>
              <div>
                <h4 className="font-black text-sm text-white">Pending Media</h4>
                <p className="text-[10px] text-zinc-500">Tasks waiting for media files before publishing</p>
              </div>
            </div>
            <button
              onClick={() => void loadPendingMedia()}
              className="px-3 py-1.5 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-400 font-black rounded-lg text-[10px] transition-all flex items-center gap-1.5"
            >
              <RefreshCw className="w-3 h-3" />
              Refresh
            </button>
          </div>

          <div className="space-y-3">
            {pendingMediaTasks.map((t: any) => {
              const caption = t.payload?.caption || '(no caption)';
              const source = t.payload?.source || 'unknown';
              const customer = t.payload?.customerHandle || '';
              return (
                <div key={t.id} className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-zinc-300 truncate">{caption}</p>
                      <p className="text-[10px] text-zinc-500 mt-0.5">from @{customer} &middot; {source}</p>
                    </div>
                    <span className="px-2 py-0.5 bg-amber-500/10 text-[9px] font-black rounded-full text-amber-500 uppercase tracking-widest border border-amber-500/20 ml-3">
                      {t.errorReason || 'no media'}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <textarea
                      value={mediaFileInputs[t.id] || ''}
                      onChange={(e) => setMediaFileInputs(prev => ({ ...prev, [t.id]: e.target.value }))}
                      placeholder="Drop file paths here, one per line&#10;e.g. C:\media\image1.jpg"
                      className="flex-1 bg-black/40 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-300 placeholder-zinc-700 font-mono outline-none focus:border-amber-500/50 resize-none"
                      rows={2}
                    />
                    <button
                      onClick={() => void attachMedia(t.id)}
                      disabled={!mediaFileInputs[t.id]?.trim()}
                      className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white font-black rounded-lg text-[10px] transition-all flex items-center gap-1.5 self-end"
                    >
                      Attach
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Bot Health Section */}
      <div className="bg-[#111] border border-zinc-800/50 p-6 rounded-[2rem]">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center border",
              botHealth && botHealth.criticalAlerts > 0
                ? "bg-rose-500/10 border-rose-500/20"
                : "bg-zinc-900 border-zinc-800"
            )}>
              <AlertTriangle className={cn("w-5 h-5",
                botHealth && botHealth.criticalAlerts > 0 ? "text-rose-500" : "text-zinc-500"
              )} />
            </div>
            <div>
              <h4 className="font-black text-sm text-white">Bot Health</h4>
              <p className="text-[10px] text-zinc-500">Heartbeat monitoring & alerts</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {botHealth && (botHealth.criticalAlerts > 0 || botHealth.warningAlerts > 0) && (
              <span className="px-2 py-1 bg-rose-500/10 text-[9px] font-black rounded-lg text-rose-400 border border-rose-500/20 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                {botHealth.criticalAlerts} critical / {botHealth.warningAlerts} warning
              </span>
            )}
            <button
              onClick={() => void loadBotHealth()}
              className="px-3 py-1.5 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-400 font-black rounded-lg text-[10px] transition-all flex items-center gap-1.5"
            >
              <RefreshCw className="w-3 h-3" />
              Refresh
            </button>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          {[
            { label: 'Total', value: botHealth?.total ?? '—', color: 'text-zinc-300' },
            { label: 'Online', value: botHealth?.online ?? '—', color: 'text-green-400' },
            { label: 'Offline', value: botHealth?.offline ?? '—', color: 'text-rose-400' },
            { label: 'Paused', value: botHealth?.paused ?? '—', color: 'text-amber-400' },
          ].map(s => (
            <div key={s.label} className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-3 text-center">
              <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-1">{s.label}</p>
              <p className={cn("text-xl font-black", s.color)}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Bot list */}
        {botHealth && botHealth.bots.length > 0 ? (
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {botHealth.bots.map((b: any) => {
              const timeAgo = b.lastHeartbeatTs > 0
                ? Math.round((Date.now() - b.lastHeartbeatTs) / 1000)
                : null;
              const isAlert = b.alert === 'critical' || b.alert === 'warning';
              return (
                <div key={b.botId} className={cn(
                  "flex items-center justify-between p-2.5 rounded-xl border transition-all",
                  b.status === 'online' ? "bg-zinc-900/30 border-zinc-800" :
                  b.status === 'paused' ? "bg-amber-500/5 border-amber-500/20" :
                  isAlert ? "bg-rose-500/5 border-rose-500/20" :
                  "bg-zinc-900/30 border-zinc-800"
                )}>
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={cn(
                      "w-2 h-2 rounded-full flex-shrink-0",
                      b.status === 'online' ? "bg-green-500 shadow-sm shadow-green-500/50" :
                      b.status === 'paused' ? "bg-amber-500" :
                      isAlert ? "bg-rose-500 animate-pulse" : "bg-zinc-600"
                    )} />
                    <span className="text-xs font-bold text-zinc-300 truncate font-mono">{b.botId}</span>
                    <span className={cn(
                      "text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded",
                      b.status === 'online' ? "text-green-500 bg-green-500/10" :
                      b.status === 'paused' ? "text-amber-500 bg-amber-500/10" :
                      isAlert ? "text-rose-500 bg-rose-500/10" : "text-zinc-600 bg-zinc-800"
                    )}>
                      {b.status}
                    </span>
                    {b.host && <span className="text-[9px] text-zinc-600 font-mono hidden md:inline">{b.host}</span>}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                    {timeAgo !== null && (
                      <span className={cn(
                        "text-[10px] font-mono",
                        b.status === 'online' ? "text-zinc-500" :
                        timeAgo > 300 ? "text-rose-500" :
                        timeAgo > 120 ? "text-amber-500" : "text-zinc-500"
                      )}>
                        {timeAgo < 60 ? `${timeAgo}s` : `${Math.floor(timeAgo / 60)}m`}
                        {b.status === 'online' ? ' ago' : ' offline'}
                      </span>
                    )}
                    {b.alert === 'critical' && <AlertTriangle className="w-3 h-3 text-rose-500" />}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-zinc-600 text-center py-4 font-medium">No bots registered yet</p>
        )}
      </div>

      {/* A/B Testing Section */}
      {abTestData.length > 0 && (
        <div className="bg-[#111] border border-zinc-800/50 p-6 rounded-[2rem]">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-violet-500/10 rounded-xl flex items-center justify-center border border-violet-500/20">
                <BarChart3 className="w-5 h-5 text-violet-500" />
              </div>
              <div>
                <h4 className="font-black text-sm text-white">Script A/B Testing</h4>
                <p className="text-[10px] text-zinc-500">Compare conversion rates by category</p>
              </div>
            </div>
            <button
              onClick={() => void autoOptimize()}
              disabled={optimizing}
              className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white font-black rounded-lg text-[10px] transition-all flex items-center gap-1.5"
            >
              {optimizing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
              {optimizing ? 'Optimizing...' : 'Auto-Optimize'}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {abTestData.map((cat: any) => (
              <div key={cat.category} className="bg-zinc-900/30 border border-zinc-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <h5 className="text-xs font-black text-zinc-200 uppercase tracking-wider">{cat.category.replace(/_/g, ' ')}</h5>
                  <span className="text-[9px] text-zinc-500">{cat.scriptCount} scripts</span>
                </div>

                {cat.bestScript && (
                  <div className="flex items-center gap-2 mb-3 p-2 bg-emerald-500/5 border border-emerald-500/20 rounded-lg">
                    <Sparkles className="w-3 h-3 text-emerald-500 flex-shrink-0" />
                    <span className="text-[9px] text-emerald-400 font-bold truncate">
                      Best: {cat.bestScript.title} ({cat.bestScript.conversionRate}% conv)
                    </span>
                  </div>
                )}

                <div className="space-y-1.5">
                  {cat.scripts.map((s: any) => {
                    const maxVal = Math.max(s.taskSentCount, s.taskRepliedCount, s.taskConvertedCount, 1);
                    return (
                      <div key={s.id} className={cn(
                        "p-2 rounded-lg border",
                        s.active ? "bg-zinc-900/50 border-zinc-800" : "bg-zinc-900/20 border-zinc-800/50 opacity-60"
                      )}>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-[10px] font-bold text-zinc-300 truncate">{s.title}</span>
                            {!s.active && <span className="text-[8px] text-zinc-600 font-black">INACTIVE</span>}
                            {cat.bestScript?.id === s.id && s.active && (
                              <Sparkles className="w-2.5 h-2.5 text-emerald-500 flex-shrink-0" />
                            )}
                          </div>
                          <span className={cn(
                            "text-[9px] font-black px-1.5 py-0.5 rounded",
                            s.conversionRate >= 20 ? "text-emerald-500 bg-emerald-500/10" :
                            s.conversionRate >= 10 ? "text-amber-500 bg-amber-500/10" :
                            "text-zinc-600 bg-zinc-800"
                          )}>
                            {s.conversionRate}% conv
                          </span>
                        </div>

                        {/* Mini bar chart: sent vs replied vs converted */}
                        <div className="flex gap-0.5 h-2 rounded-full overflow-hidden bg-zinc-900">
                          <div className="bg-blue-500/70 h-full transition-all" style={{ width: `${(s.taskSentCount / maxVal) * 100}%` }} />
                          <div className="bg-purple-500/70 h-full transition-all" style={{ width: `${(s.taskRepliedCount / maxVal) * 100}%` }} />
                          <div className="bg-emerald-500/70 h-full transition-all" style={{ width: `${(s.taskConvertedCount / maxVal) * 100}%` }} />
                        </div>
                        <div className="flex gap-3 mt-1 text-[8px] text-zinc-600">
                          <span>Sent: {s.taskSentCount}</span>
                          <span>Replied: {s.taskRepliedCount}</span>
                          <span>Converted: {s.taskConvertedCount}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
