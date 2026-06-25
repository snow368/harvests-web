import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Shield,
  Zap,
  Clock,
  Activity,
  UserCheck,
  Play,
  Globe,
  Eye,
  MousePointer2,
  MessageSquare,
  UserPlus,
  Monitor,
  Instagram,
  Settings,
  Heart,
  Search,
  Key,
  Send,
  Loader2,
  Bot,
  ShoppingCart,
  CheckSquare
} from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '../lib/utils';
import { useCRM } from '../contexts/CRMContext';
import { InstagramAccount, TaskAssignment } from '../types/crm';
import { toast } from 'sonner';
import DataDashboard from './DataDashboard';

type BotTaskType = 'ig_outreach' | 'reddit_intel' | 'supply_analysis';
type SupplyAccountType = 'supply_brand' | 'supply_distributor';

const TASK_TYPE_CONFIG: Record<BotTaskType, { label: string; icon: React.ElementType; color: string; description: string }> = {
  ig_outreach: {
    label: 'IG Outreach',
    icon: Instagram,
    color: 'text-rose-500',
    description: 'Auto like, comment, follow target artists on Instagram'
  },
  reddit_intel: {
    label: 'Reddit Intel',
    icon: Search,
    color: 'text-orange-500',
    description: 'Scrape subreddits via CloakBrowser, AI classify posts, route intel'
  },
  supply_analysis: {
    label: 'Supply Analysis',
    icon: ShoppingCart,
    color: 'text-cyan-500',
    description: 'Browse competitor supply accounts, scrape comments & content'
  }
};

const DEV_KEY_STORAGE_KEY = 'inkflow_dev_api_key';

const StatusBadge = ({ status }: { status: InstagramAccount['status'] }) => {
  const styles = {
    idle: 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20',
    running: 'bg-green-500/10 text-green-500 border-green-500/20 animate-pulse',
    cooldown: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
    banned: 'bg-red-500/10 text-red-500 border-red-500/20'
  };

  return (
    <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-black uppercase border", styles[status])}>
      {status}
    </span>
  );
};

export default function AutomationCommandCenter() {
  const { accounts, assignments, artists, assignTaskToAccount, startAutomationSequence } = useCRM();
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [taskModes, setTaskModes] = useState<Record<string, BotTaskType>>({});
  const [expandedAccount, setExpandedAccount] = useState<string | null>(null);
  const [devKey, setDevKey] = useState<string>(() => {
    try { return localStorage.getItem(DEV_KEY_STORAGE_KEY) || ''; } catch { return ''; }
  });
  const [showDevKeyInput, setShowDevKeyInput] = useState(false);
  const [dispatching, setDispatching] = useState<string | null>(null);
  const [redditSubreddits, setRedditSubreddits] = useState<Record<string, string>>({});
  const [redditPostsPerSub, setRedditPostsPerSub] = useState<Record<string, number>>({});
  const [supplyAcctType, setSupplyAcctType] = useState<Record<string, SupplyAccountType>>({});
  const [supplyManualMode, setSupplyManualMode] = useState<Record<string, boolean>>({});
  const [supplySelected, setSupplySelected] = useState<Record<string, string[]>>({});
  const [competitors, setCompetitors] = useState<Array<{ handle: string; account_type: string; source: string }>>([]);
  const [competitorSearch, setCompetitorSearch] = useState<Record<string, string>>({});

  const activeAssignments = useMemo(() => {
    return assignments.filter(a => a.status === 'pending');
  }, [assignments]);

  const getTaskMode = (accountId: string): BotTaskType => {
    return taskModes[accountId] || 'ig_outreach';
  };

  const handleStartSequence = async (assignment: TaskAssignment) => {
    await startAutomationSequence(assignment.artistId, assignment.accountId);
  };

  const getArtistHandle = (id: string) => {
    return artists.find(a => a.id === id)?.username || 'Unknown';
  };

  const getAccountHandle = (id: string) => {
    return accounts.find(a => a.id === id)?.username || 'Unknown';
  };

  const handleSaveDevKey = useCallback(() => {
    try { localStorage.setItem(DEV_KEY_STORAGE_KEY, devKey); } catch {}
    setShowDevKeyInput(false);
    toast.success('Dev API key saved');
  }, [devKey]);

  // Fetch competitors list for manual supply mode
  useEffect(() => {
    fetch('/api/content/competitors')
      .then(r => r.json())
      .then(data => {
        const list = Array.isArray(data) ? data : data?.rows || [];
        setCompetitors(list.map((c: any) => ({
          handle: c.ig_handle || c.handle || '',
          account_type: c.account_type || 'supply_brand',
          source: c.source || '',
        })));
      })
      .catch(() => {});
  }, []);

  const handleToggleCompetitor = useCallback((accountId: string, handle: string) => {
    setSupplySelected(prev => {
      const current = prev[accountId] || [];
      const next = current.includes(handle)
        ? current.filter(h => h !== handle)
        : [...current, handle];
      return { ...prev, [accountId]: next };
    });
  }, []);

  const handleSelectAll = useCallback((accountId: string, handles: string[]) => {
    setSupplySelected(prev => ({ ...prev, [accountId]: [...handles] }));
  }, []);

  const handleDeselectAll = useCallback((accountId: string) => {
    setSupplySelected(prev => ({ ...prev, [accountId]: [] }));
  }, []);

  const handleDispatchReddit = useCallback(async (accountId: string) => {
    if (!devKey) {
      setShowDevKeyInput(true);
      toast.error('Dev API key required for Reddit intel dispatch');
      return;
    }
    const subs = redditSubreddits[accountId] || 'tattoo,tattoos,tattooartists,TattooApprentice,agedtattoos';
    const posts = redditPostsPerSub[accountId] || 15;
    setDispatching(accountId);
    try {
      const res = await fetch('/api/intel/reddit/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-dev-key': devKey },
        body: JSON.stringify({ subreddits: subs, postsPerSub: posts })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Dispatch failed');
      toast.success(`Reddit Intel dispatched: ${data.tasks} task(s)`, {
        description: `Subreddits: ${data.subreddits?.join(', ') || subs}`
      });
    } catch (e: any) {
      toast.error(e.message || 'Reddit dispatch failed');
    } finally {
      setDispatching(null);
    }
  }, [devKey, redditSubreddits, redditPostsPerSub]);

  const handleDispatchSupply = useCallback(async (accountId: string) => {
    const acctType = supplyAcctType[accountId] || 'supply_brand';
    const isManual = supplyManualMode[accountId];
    const selected = supplySelected[accountId] || [];

    if (isManual && selected.length === 0) {
      toast.error('Please select at least one competitor');
      return;
    }

    setDispatching(accountId);
    try {
      const body: Record<string, any> = {};
      if (isManual) {
        body.handles = selected;
        body.accountType = acctType;
      } else {
        body.accountType = acctType;
        body.limit = 10;
      }
      const res = await fetch('/api/automation/generate-from-competitors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Dispatch failed');
      toast.success(`Supply Analysis dispatched: ${data.created} tasks`, {
        description: `Type: ${isManual ? 'manual' : 'auto'} | Created: ${data.created} | Skipped: ${data.skipped}`
      });
    } catch (e: any) {
      toast.error(e.message || 'Supply dispatch failed');
    } finally {
      setDispatching(null);
    }
  }, [supplyAcctType, supplyManualMode, supplySelected]);

  const toggleTaskMode = useCallback((accountId: string, mode: BotTaskType) => {
    setTaskModes(prev => ({ ...prev, [accountId]: mode }));
    setExpandedAccount(accountId);
  }, []);

  return (
    <div className="space-y-8">
      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {[
          { label: 'Active Accounts', value: accounts.length, icon: Shield, color: 'text-blue-500' },
          { label: 'Pending Tasks', value: activeAssignments.length, icon: Clock, color: 'text-amber-500' },
          { label: 'Daily Actions', value: accounts.reduce((acc, curr) => acc + curr.dailyActionCount, 0), icon: Zap, color: 'text-rose-500' },
          { label: 'Safety Score', value: '98%', icon: UserCheck, color: 'text-green-500' },
        ].map((stat, i) => (
          <div key={i} className="p-6 bg-zinc-900/50 border border-zinc-800 rounded-3xl">
            <div className="flex items-center justify-between mb-4">
              <div className={cn("p-2 rounded-xl bg-zinc-800", stat.color)}>
                <stat.icon className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Live</span>
            </div>
            <p className="text-2xl font-black text-white">{stat.value}</p>
            <p className="text-xs font-medium text-zinc-500 mt-1">{stat.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Account Management */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-500/10 rounded-2xl flex items-center justify-center border border-blue-500/20">
                <Monitor className="w-6 h-6 text-blue-500" />
              </div>
              <div>
                <h3 className="text-xl font-black text-white">Account Fleet</h3>
                <p className="text-xs text-zinc-500 font-medium">AdsPower / Playwright Orchestration</p>
              </div>
            </div>
            <button className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold rounded-xl transition-colors">
              Add Account
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {accounts.map(account => {
              const activeMode = getTaskMode(account.id);
              const modeCfg = TASK_TYPE_CONFIG[activeMode];
              const isExpanded = expandedAccount === account.id;
              const isDispatching = dispatching === account.id;
              const accountCompetitors = competitors.filter(c => {
                const acctType = supplyAcctType[account.id] || 'supply_brand';
                return c.account_type === acctType;
              });
              const searchQ = (competitorSearch[account.id] || '').toLowerCase();
              const filteredCompetitors = searchQ
                ? accountCompetitors.filter(c => c.handle.toLowerCase().includes(searchQ))
                : accountCompetitors;

              return (
              <motion.div
                key={account.id}
                layout
                onClick={() => setSelectedAccountId(account.id)}
                className={cn(
                  "p-5 rounded-[2rem] border transition-all cursor-pointer group",
                  selectedAccountId === account.id
                    ? "bg-blue-500/5 border-blue-500/30 ring-1 ring-blue-500/30"
                    : "bg-zinc-900/50 border-zinc-800 hover:border-zinc-700"
                )}
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className={cn("w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center overflow-hidden border border-zinc-700", modeCfg.color)}>
                      <modeCfg.icon className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-sm font-black text-white">@{account.username}</p>
                      <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">{account.behaviorProfile} Profile</p>
                    </div>
                  </div>
                  <StatusBadge status={account.status} />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between text-[10px] font-bold">
                    <span className="text-zinc-500 uppercase tracking-widest">Daily Limit</span>
                    <span className="text-zinc-300">{account.dailyActionCount} / 50</span>
                  </div>
                  <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-all duration-500"
                      style={{ width: `${(account.dailyActionCount / 50) * 100}%` }}
                    />
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-zinc-800/50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Globe className="w-3 h-3 text-zinc-600" />
                    <span className="text-[10px] font-medium text-zinc-500">Proxy: {account.proxyIp || 'None'}</span>
                  </div>
                  <button
                    className="text-zinc-500 hover:text-white transition-colors"
                    onClick={(e) => { e.stopPropagation(); setExpandedAccount(isExpanded ? null : account.id); }}
                  >
                    <Settings className="w-4 h-4" />
                  </button>
                </div>

                {/* Task Mode Selector */}
                <div className="mt-3 pt-3 border-t border-zinc-800/30">
                  <div className="flex items-center gap-2 mb-2">
                    <Bot className="w-3 h-3 text-zinc-500" />
                    <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Task Mode</span>
                  </div>
                  <div className="flex gap-1.5">
                    {(Object.keys(TASK_TYPE_CONFIG) as BotTaskType[]).map(type => {
                      const cfg = TASK_TYPE_CONFIG[type];
                      const isActive = activeMode === type;
                      return (
                        <button
                          key={type}
                          onClick={(e) => { e.stopPropagation(); toggleTaskMode(account.id, type); }}
                          className={cn(
                            "flex-1 px-2 py-1.5 rounded-xl text-[9px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-1",
                            isActive
                              ? cn("bg-zinc-700 text-white border border-zinc-600", cfg.color)
                              : "bg-zinc-800/50 text-zinc-500 border border-transparent hover:border-zinc-700 hover:text-zinc-300"
                          )}
                        >
                          <cfg.icon className="w-3 h-3" />
                          {type === 'ig_outreach' ? 'IG' : type === 'reddit_intel' ? 'Reddit' : 'Supply'}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Expanded: Parameters + Dispatch */}
                {isExpanded && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mt-3 pt-3 border-t border-zinc-800/30 space-y-3"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <p className="text-[10px] text-zinc-500 font-medium">{modeCfg.description}</p>

                    {/* IG Outreach params */}
                    {activeMode === 'ig_outreach' && (
                      <div className="space-y-2">
                        <p className="text-[10px] text-zinc-500">
                          Use the <span className="text-rose-400 font-bold">Task Queue</span> panel to assign artists, then click Execute Protocol.
                        </p>
                      </div>
                    )}

                    {/* Reddit Intel params */}
                    {activeMode === 'reddit_intel' && (
                      <div className="space-y-2">
                        <div>
                          <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Subreddits</label>
                          <input
                            type="text"
                            value={redditSubreddits[account.id] || 'tattoo,tattoos,tattooartists'}
                            onChange={(e) => setRedditSubreddits(prev => ({ ...prev, [account.id]: e.target.value }))}
                            placeholder="tattoo,tattoos,tattooartists,TattooApprentice,agedtattoos"
                            className="mt-1 w-full px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-xl text-xs text-white font-medium focus:outline-none focus:border-orange-500/50"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Posts per sub</label>
                          <input
                            type="number"
                            min={5}
                            max={50}
                            value={redditPostsPerSub[account.id] ?? 15}
                            onChange={(e) => setRedditPostsPerSub(prev => ({ ...prev, [account.id]: Math.max(5, Math.min(50, parseInt(e.target.value) || 15)) }))}
                            className="mt-1 w-full px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-xl text-xs text-white font-medium focus:outline-none focus:border-orange-500/50"
                          />
                        </div>
                        {!devKey && (
                          <div className="flex items-center gap-2">
                            <Key className="w-3 h-3 text-amber-500" />
                            <button
                              onClick={() => setShowDevKeyInput(true)}
                              className="text-[10px] font-bold text-amber-500 hover:text-amber-400"
                            >
                              Set Dev API Key
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Supply Analysis params */}
                    {activeMode === 'supply_analysis' && (
                      <div className="space-y-2">
                        <div>
                          <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Account Type</label>
                          <div className="flex gap-1.5 mt-1">
                            {(['supply_brand', 'supply_distributor'] as SupplyAccountType[]).map(t => (
                              <button
                                key={t}
                                onClick={() => setSupplyAcctType(prev => ({ ...prev, [account.id]: t }))}
                                className={cn(
                                  "flex-1 px-2 py-1.5 rounded-xl text-[9px] font-bold uppercase tracking-wider transition-all",
                                  (supplyAcctType[account.id] || 'supply_brand') === t
                                    ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                                    : "bg-zinc-800/50 text-zinc-500 border border-transparent hover:border-zinc-700"
                                )}
                              >
                                {t === 'supply_brand' ? 'Brand' : 'Distributor'}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Auto / Manual toggle */}
                        <div className="pt-2">
                          <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Mode</label>
                          <div className="flex gap-1.5 mt-1">
                            {(['auto', 'manual'] as const).map(mode => (
                              <button
                                key={mode}
                                onClick={() => setSupplyManualMode(prev => ({ ...prev, [account.id]: mode === 'manual' }))}
                                className={cn(
                                  "flex-1 px-2 py-1.5 rounded-xl text-[9px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-1",
                                  (supplyManualMode[account.id] ? 'manual' : 'auto') === mode
                                    ? mode === 'auto'
                                      ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                                      : "bg-violet-500/20 text-violet-400 border border-violet-500/30"
                                    : "bg-zinc-800/50 text-zinc-500 border border-transparent hover:border-zinc-700"
                                )}
                              >
                                {mode === 'auto' ? <Zap className="w-3 h-3" /> : <CheckSquare className="w-3 h-3" />}
                                {mode === 'auto' ? 'Auto All' : 'Manual Pick'}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Manual: competitor checklist */}
                        {supplyManualMode[account.id] && (
                          <div className="pt-2">
                            <div className="flex items-center gap-2 mb-1">
                              <input
                                type="text"
                                value={competitorSearch[account.id] || ''}
                                onChange={(e) => setCompetitorSearch(prev => ({ ...prev, [account.id]: e.target.value }))}
                                placeholder="Search competitors..."
                                className="flex-1 px-2.5 py-1.5 bg-zinc-800 border border-zinc-700 rounded-xl text-[10px] text-white font-medium focus:outline-none focus:border-violet-500/50"
                              />
                            </div>
                            <div className="flex items-center gap-2 mb-1">
                              <button
                                onClick={() => handleSelectAll(account.id, filteredCompetitors.map(c => c.handle))}
                                className="text-[9px] font-bold text-violet-400 hover:text-violet-300"
                              >
                                Select All
                              </button>
                              <span className="text-zinc-600 text-[9px]">|</span>
                              <button
                                onClick={() => handleDeselectAll(account.id)}
                                className="text-[9px] font-bold text-zinc-500 hover:text-zinc-400"
                              >
                                Deselect All
                              </button>
                              <span className="text-zinc-600 text-[9px]">|</span>
                              <span className="text-[9px] text-zinc-500">
                                {(supplySelected[account.id] || []).length} / {filteredCompetitors.length} selected
                              </span>
                            </div>
                            <div className="max-h-32 overflow-y-auto space-y-0.5 border border-zinc-800 rounded-xl p-1">
                              {filteredCompetitors.map(c => {
                                const sel = (supplySelected[account.id] || []).includes(c.handle);
                                return (
                                  <label
                                    key={c.handle}
                                    className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-zinc-800/50 cursor-pointer transition-colors"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={sel}
                                      onChange={() => handleToggleCompetitor(account.id, c.handle)}
                                      className="accent-violet-500 w-3 h-3"
                                    />
                                    <span className="text-[10px] font-medium text-zinc-300">@{c.handle}</span>
                                    <span className="text-[8px] text-zinc-600 ml-auto uppercase">{c.account_type === 'supply_brand' ? 'Brand' : 'Dist'}</span>
                                  </label>
                                );
                              })}
                              {filteredCompetitors.length === 0 && (
                                <p className="text-[10px] text-zinc-600 text-center py-4">No competitors found</p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Dispatch Button */}
                    <button
                      disabled={isDispatching || (activeMode === 'reddit_intel' && !devKey)}
                      onClick={() => {
                        if (activeMode === 'reddit_intel') handleDispatchReddit(account.id);
                        else if (activeMode === 'supply_analysis') handleDispatchSupply(account.id);
                      }}
                      className={cn(
                        "w-full py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2",
                        activeMode === 'ig_outreach'
                          ? "bg-zinc-700 text-zinc-400 cursor-not-allowed"
                          : isDispatching
                            ? "bg-zinc-700 text-zinc-400"
                            : cn("bg-zinc-700 hover:bg-zinc-600 text-white", modeCfg.color)
                      )}
                    >
                      {isDispatching ? (
                        <><Loader2 className="w-3 h-3 animate-spin" /> Dispatching...</>
                      ) : activeMode === 'ig_outreach' ? (
                        <>Use Task Queue</>
                      ) : activeMode === 'supply_analysis' && supplyManualMode[account.id] ? (
                        <><Send className="w-3 h-3" /> Dispatch Selected ({(supplySelected[account.id] || []).length})</>
                      ) : (
                        <><Send className="w-3 h-3" /> Dispatch {modeCfg.label}</>
                      )}
                    </button>

                    {/* Dev Key Input (shown when needed) */}
                    {activeMode === 'reddit_intel' && showDevKeyInput && (
                      <div className="flex gap-2">
                        <input
                          type="password"
                          value={devKey}
                          onChange={(e) => setDevKey(e.target.value)}
                          placeholder="Paste dev API key..."
                          className="flex-1 px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-xl text-xs text-white font-medium focus:outline-none focus:border-amber-500/50"
                        />
                        <button
                          onClick={handleSaveDevKey}
                          className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-bold rounded-xl transition-colors"
                        >
                          Save
                        </button>
                      </div>
                    )}
                  </motion.div>
                )}
              </motion.div>
            );
            })}
          </div>
        </div>

        {/* Task Queue */}
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-rose-500/10 rounded-2xl flex items-center justify-center border border-rose-500/20">
              <Activity className="w-6 h-6 text-rose-500" />
            </div>
            <div>
              <h3 className="text-xl font-black text-white">Task Queue</h3>
              <p className="text-xs text-zinc-500 font-medium">Real-time Orchestration</p>
            </div>
          </div>

          <div className="space-y-3">
            {activeAssignments.length > 0 ? (
              activeAssignments.map(assignment => (
                <div key={assignment.id} className="p-4 bg-zinc-900/80 border border-zinc-800 rounded-2xl group hover:border-rose-500/30 transition-all">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Target</span>
                      <span className="text-xs font-black text-white">@{getArtistHandle(assignment.artistId)}</span>
                    </div>
                    <span className="text-[10px] font-bold text-rose-500 bg-rose-500/10 px-2 py-0.5 rounded-lg">Pending</span>
                  </div>
                  
                  <div className="flex items-center gap-2 mb-4">
                    <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Via</span>
                    <span className="text-xs font-bold text-zinc-400">@{getAccountHandle(assignment.accountId)}</span>
                  </div>

                  <button 
                    onClick={() => handleStartSequence(assignment)}
                    className="w-full py-2 bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2"
                  >
                    <Play className="w-3 h-3 fill-current" />
                    Execute Protocol
                  </button>
                </div>
              ))
            ) : (
              <div className="p-10 bg-zinc-900/30 border border-dashed border-zinc-800 rounded-[2rem] flex flex-col items-center justify-center text-center">
                <div className="w-12 h-12 rounded-2xl bg-zinc-800/50 flex items-center justify-center mb-4">
                  <Clock className="w-6 h-6 text-zinc-600" />
                </div>
                <p className="text-sm font-bold text-zinc-500">No pending tasks</p>
                <p className="text-[10px] text-zinc-600 mt-1">Assign artists from the CRM to start automation</p>
              </div>
            )}
          </div>

          {/* Protocol Visualization */}
          <div className="p-6 bg-zinc-900/50 border border-zinc-800 rounded-[2rem]">
            <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-6 flex items-center gap-2">
              <Shield className="w-3 h-3" />
              Anti-Ban Protocol
            </h4>
            
            <div className="space-y-6">
              {[
                { label: 'Profile Entry', icon: Eye, delay: '0s' },
                { label: 'Random Scroll', icon: MousePointer2, delay: '12s' },
                { label: 'Like Recent', icon: Heart, delay: '45s' },
                { label: 'AI Comment', icon: MessageSquare, delay: '120s' },
                { label: 'Follow', icon: UserPlus, delay: '180s' },
              ].map((step, i) => (
                <div key={i} className="flex items-center gap-4 relative">
                  {i < 4 && <div className="absolute left-4 top-8 bottom-[-1.5rem] w-px bg-zinc-800" />}
                  <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center z-10 border border-zinc-700">
                    <step.icon className="w-4 h-4 text-zinc-400" />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs font-bold text-zinc-300">{step.label}</p>
                    <p className="text-[10px] text-zinc-600 font-medium">Jitter Delay: {step.delay}</p>
                  </div>
                  <div className="w-2 h-2 rounded-full bg-zinc-800" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ─── 数据看板 ─── */}
      <DataDashboard />
    </div>
  );
}
