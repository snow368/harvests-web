import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { cn } from '../lib/utils';
import { toast } from 'sonner';

type BotObservation = {
  id: number;
  botId: string;
  artistId?: string | null;
  artistHandle?: string | null;
  mode?: string | null;
  summary?: { totalMedia?: number; opened?: number; desiredOpenCount?: number };
  profileFacts?: any;
  createdAt?: string;
};

export default function BotReviewPanels() {
  const [botObservations, setBotObservations] = useState<BotObservation[]>([]);
  const [botObsLoading, setBotObsLoading] = useState(false);
  const [botOnline, setBotOnline] = useState<any[]>([]);
  const [selectedBotId, setSelectedBotId] = useState('');
  const [botCtlLoading, setBotCtlLoading] = useState(false);
  const [coverage, setCoverage] = useState<any>(null);
  const [scheduleCfg, setScheduleCfg] = useState<any>({
    enabled: false,
    pauseWindow: { start: '22:00', end: '23:30' },
    resumeWindow: { start: '08:30', end: '10:00' },
    resumeBotIds: []
  });
  const [scheduleState, setScheduleState] = useState<any>(null);
  const [reviewCandidates, setReviewCandidates] = useState<any[]>([]);
  const [keptCandidates, setKeptCandidates] = useState<any[]>([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadBotObservations = useCallback(async () => {
    try {
      setBotObsLoading(true);
      const res = await fetch('/api/bot/observations?limit=100');
      if (!res.ok) return;
      const payload = await res.json();
      setBotObservations(Array.isArray(payload?.observations) ? payload.observations : []);
    } finally {
      setBotObsLoading(false);
    }
  }, []);

  const loadReviewCandidates = useCallback(async () => {
    try {
      setReviewLoading(true);
      const res = await fetch('/api/review/non-tattoo-candidates?limit=100');
      if (!res.ok) return;
      const payload = await res.json();
      setReviewCandidates(Array.isArray(payload?.rows) ? payload.rows : []);
    } finally {
      setReviewLoading(false);
    }
  }, []);

  const loadKeptCandidates = useCallback(async () => {
    const res = await fetch('/api/review/kept-candidates?limit=200');
    if (!res.ok) return;
    const payload = await res.json();
    setKeptCandidates(Array.isArray(payload?.rows) ? payload.rows : []);
  }, []);

  const loadBotOnline = useCallback(async () => {
    const res = await fetch('/api/bot/online');
    if (!res.ok) return;
    const payload = await res.json();
    const bots = Array.isArray(payload?.bots) ? payload.bots : [];
    setBotOnline(bots);
    setSelectedBotId((prev) => prev || (bots[0]?.botId || ''));
  }, []);

  const loadCoverage = useCallback(async () => {
    const res = await fetch('/api/bot/coverage?state=WA');
    if (!res.ok) return;
    const payload = await res.json();
    setCoverage(payload || null);
  }, []);

  const loadSchedule = useCallback(async () => {
    const res = await fetch('/api/bot/schedule');
    if (!res.ok) return;
    const payload = await res.json();
    if (payload?.config) setScheduleCfg(payload.config);
    setScheduleState(payload?.state || null);
  }, []);

  const saveSchedule = useCallback(async () => {
    try {
      const res = await fetch('/api/bot/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(scheduleCfg)
      });
      if (!res.ok) throw new Error('schedule_save_failed');
      toast.success('Bot schedule saved');
      await loadSchedule();
    } catch {
      toast.error('Schedule save failed');
    }
  }, [scheduleCfg, loadSchedule]);

  const triggerPauseNow = useCallback(async () => {
    try {
      const res = await fetch('/api/bot/schedule/trigger/pause-now', { method: 'POST' });
      if (!res.ok) throw new Error('trigger_pause_failed');
      const payload = await res.json();
      toast.success(`Paused now: ${Number(payload?.paused || 0)} bots`);
      await loadBotOnline();
    } catch {
      toast.error('Trigger pause failed');
    }
  }, [loadBotOnline]);

  const triggerResumeNow = useCallback(async () => {
    try {
      const res = await fetch('/api/bot/schedule/trigger/resume-now', { method: 'POST' });
      if (!res.ok) throw new Error('trigger_resume_failed');
      const payload = await res.json();
      toast.success(`Resumed now: ${Number(payload?.resumed || 0)} bots`);
      await loadBotOnline();
    } catch {
      toast.error('Trigger resume failed');
    }
  }, [loadBotOnline]);

  const regenerateTodayPlan = useCallback(async () => {
    try {
      const res = await fetch('/api/bot/schedule/trigger/regenerate-today', { method: 'POST' });
      if (!res.ok) throw new Error('regen_failed');
      toast.success('Today random plan regenerated');
      await loadSchedule();
    } catch {
      toast.error('Regenerate today plan failed');
    }
  }, [loadSchedule]);

  const pauseBot = useCallback(async () => {
    if (!selectedBotId) return;
    try {
      setBotCtlLoading(true);
      const res = await fetch(`/api/bot/pause/${encodeURIComponent(selectedBotId)}`, { method: 'POST' });
      if (!res.ok) throw new Error('pause_failed');
      toast.success(`Paused ${selectedBotId}`);
      await loadBotOnline();
    } catch {
      toast.error('Pause failed');
    } finally {
      setBotCtlLoading(false);
    }
  }, [selectedBotId, loadBotOnline]);

  const resumeBot = useCallback(async () => {
    if (!selectedBotId) return;
    try {
      setBotCtlLoading(true);
      const res = await fetch(`/api/bot/resume/${encodeURIComponent(selectedBotId)}`, { method: 'POST' });
      if (!res.ok) throw new Error('resume_failed');
      toast.success(`Resumed ${selectedBotId}`);
      await loadBotOnline();
    } catch {
      toast.error('Resume failed');
    } finally {
      setBotCtlLoading(false);
    }
  }, [selectedBotId, loadBotOnline]);

  const pauseResumeById = useCallback(async (botId: string, action: 'pause' | 'resume') => {
    if (!botId) return;
    const path = action === 'pause' ? 'pause' : 'resume';
    const res = await fetch(`/api/bot/${path}/${encodeURIComponent(botId)}`, { method: 'POST' });
    if (!res.ok) throw new Error(`${action}_failed`);
  }, []);

  const pauseAll = useCallback(async () => {
    try {
      setBotCtlLoading(true);
      const res = await fetch('/api/bot/pause-all', { method: 'POST' });
      if (!res.ok) throw new Error('pause_all_failed');
      const payload = await res.json();
      toast.success(`Paused ${Number(payload?.paused || 0)} bots`);
      await loadBotOnline();
    } catch {
      toast.error('Pause all failed');
    } finally {
      setBotCtlLoading(false);
    }
  }, [loadBotOnline]);

  const resumeAll = useCallback(async () => {
    try {
      setBotCtlLoading(true);
      const res = await fetch('/api/bot/resume-all', { method: 'POST' });
      if (!res.ok) throw new Error('resume_all_failed');
      const payload = await res.json();
      toast.success(`Resumed ${Number(payload?.resumed || 0)} bots`);
      await loadBotOnline();
    } catch {
      toast.error('Resume all failed');
    } finally {
      setBotCtlLoading(false);
    }
  }, [loadBotOnline]);

  const deleteReviewArtist = useCallback(async (row: any) => {
    try {
      const res = await fetch('/api/review/delete-artist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artistId: row?.artistId || null, artistHandle: row?.artistHandle || null, observationId: row?.observationId || null })
      });
      if (!res.ok) throw new Error('delete_failed');
      toast.success(`Deleted ${row?.artistHandle || row?.shopName || 'artist'}`);
      await loadReviewCandidates();
    } catch {
      toast.error('Delete failed');
    }
  }, [loadReviewCandidates]);

  const keepAndRequeueArtist = useCallback(async (row: any) => {
    try {
      const res = await fetch('/api/review/keep-and-requeue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artistId: row?.artistId || null,
          artistHandle: row?.artistHandle || null,
          behaviorProfile: 'warmup',
          language: 'en'
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(String(err?.error || err?.details || 'keep_requeue_failed'));
      }
      const payload = await res.json().catch(() => ({}));
      if (payload?.queued === false && payload?.reason === 'already_queued') {
        toast.success(`Kept @${row?.artistHandle || ''} (already queued)`);
      } else {
        toast.success(`Kept & requeued @${row?.artistHandle || ''}`);
      }
      await loadReviewCandidates();
      await loadBotObservations();
      await loadKeptCandidates();
    } catch {
      toast.error('Keep & requeue failed');
    }
  }, [loadReviewCandidates, loadBotObservations, loadKeptCandidates]);

  const unkeepCandidate = useCallback(async (row: any) => {
    try {
      const handle = String(row?.artistHandle || '').replace(/^@/, '').trim();
      if (!handle) return;
      const res = await fetch('/api/review/unkeep-candidate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artistHandle: handle })
      });
      if (!res.ok) throw new Error('unkeep_failed');
      toast.success(`Unkept @${handle}`);
      await loadKeptCandidates();
      await loadReviewCandidates();
    } catch {
      toast.error('Unkeep failed');
    }
  }, [loadKeptCandidates, loadReviewCandidates]);

  useEffect(() => {
    void loadBotObservations();
    void loadReviewCandidates();
    void loadBotOnline();
    void loadCoverage();
    void loadKeptCandidates();
    void loadSchedule();
    timerRef.current = setInterval(() => {
      void loadBotObservations();
      void loadReviewCandidates();
      void loadBotOnline();
      void loadCoverage();
      void loadKeptCandidates();
      void loadSchedule();
    }, 10000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [loadBotObservations, loadReviewCandidates, loadBotOnline, loadCoverage, loadKeptCandidates, loadSchedule]);

  const selectedBot = useMemo(
    () => botOnline.find((b) => String(b?.botId || '') === selectedBotId) || null,
    [botOnline, selectedBotId]
  );

  const latestObsByBot = useMemo(() => {
    const m = new Map<string, BotObservation>();
    for (const ob of botObservations) {
      const botId = String(ob.botId || '').trim();
      if (!botId) continue;
      const existing = m.get(botId);
      if (!existing) {
        m.set(botId, ob);
        continue;
      }
      const a = new Date(String(ob.createdAt || 0)).getTime();
      const b = new Date(String(existing.createdAt || 0)).getTime();
      if (a > b) m.set(botId, ob);
    }
    return m;
  }, [botObservations]);

  const renderBotWork = (bot: any) => {
    const botId = String(bot?.botId || '');
    const status = String(bot?.status || 'offline');
    if (status === 'paused') return { label: 'paused', tone: 'text-amber-300' };
    if (status === 'offline') return { label: 'offline', tone: 'text-zinc-500' };
    const ob = latestObsByBot.get(botId);
    if (!ob) return { label: 'idle', tone: 'text-zinc-400' };
    const ts = new Date(String(ob.createdAt || 0)).getTime();
    const ageMs = Date.now() - ts;
    const isWorking = ageMs <= 120000;
    const handle = String(ob.artistHandle || '').replace(/^@/, '');
    const mode = String(ob.mode || '-');
    const text = handle ? `@${handle} (${mode})` : `mode ${mode}`;
    return { label: isWorking ? `working: ${text}` : `idle: ${text}`, tone: isWorking ? 'text-emerald-300' : 'text-zinc-400' };
  };

  const relationshipRows = useMemo(() => {
    const m = new Map<string, {
      artistHandle: string;
      artistId: string;
      botIds: Set<string>;
      visits: number;
      openedTotal: number;
      mediaTotal: number;
      leadScore: number;
      followPriority: string;
      lastAt: string;
    }>();
    for (const ob of botObservations) {
      const handle = String(ob.artistHandle || '').replace(/^@/, '').trim();
      if (!handle) continue;
      const key = handle.toLowerCase();
      if (!m.has(key)) m.set(key, {
        artistHandle: handle,
        artistId: String(ob.artistId || ''),
        botIds: new Set<string>(),
        visits: 0,
        openedTotal: 0,
        mediaTotal: 0,
        leadScore: Number(ob?.profileFacts?.leadScore || 0),
        followPriority: String(ob?.profileFacts?.followPriority || ''),
        lastAt: ''
      });
      const row = m.get(key)!;
      row.botIds.add(String(ob.botId || ''));
      row.visits += 1;
      row.openedTotal += Number(ob.summary?.opened || 0);
      row.mediaTotal += Number(ob.summary?.totalMedia || 0);
      const ls = Number(ob?.profileFacts?.leadScore || 0);
      if (ls > row.leadScore) row.leadScore = ls;
      const fp = String(ob?.profileFacts?.followPriority || '').toLowerCase();
      if (!row.followPriority && fp) row.followPriority = fp;
      const ts = String(ob.createdAt || '');
      if (ts && (!row.lastAt || ts > row.lastAt)) row.lastAt = ts;
    }
    return Array.from(m.values())
      .sort((a, b) => {
        const pa = a.followPriority === 'high' ? 3 : a.followPriority === 'medium' ? 2 : a.followPriority === 'low' ? 1 : 0;
        const pb = b.followPriority === 'high' ? 3 : b.followPriority === 'medium' ? 2 : b.followPriority === 'low' ? 1 : 0;
        if (pb !== pa) return pb - pa;
        if (b.leadScore !== a.leadScore) return b.leadScore - a.leadScore;
        return (b.lastAt || '').localeCompare(a.lastAt || '');
      })
      .slice(0, 30);
  }, [botObservations]);

  const formatNum = (v: any) => {
    const n = Number(v || 0);
    return Number.isFinite(n) && n > 0 ? n.toLocaleString() : '-';
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3">
          <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-black">Bots Online</p>
          <p className="text-lg font-black text-emerald-300">{botOnline.filter((b) => String(b.status) === 'online').length}</p>
        </div>
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3">
          <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-black">Bots Paused</p>
          <p className="text-lg font-black text-amber-300">{botOnline.filter((b) => String(b.status) === 'paused').length}</p>
        </div>
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3">
          <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-black">WA Email Coverage</p>
          <p className="text-lg font-black text-blue-300">
            {coverage?.total ? `${Math.round((Number(coverage.withEmail || 0) * 100) / Number(coverage.total))}%` : '-'}
          </p>
        </div>
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3">
          <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-black">WA IG Coverage</p>
          <p className="text-lg font-black text-purple-300">
            {coverage?.total ? `${Math.round((Number(coverage.withIg || 0) * 100) / Number(coverage.total))}%` : '-'}
          </p>
        </div>
      </div>

      <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Random Range Day Schedule</p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void saveSchedule()}
              className="px-2.5 py-1 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 rounded text-[10px] font-black text-emerald-200 uppercase tracking-widest"
            >
              Save Schedule
            </button>
            <button
              onClick={() => void regenerateTodayPlan()}
              className="px-2.5 py-1 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 rounded text-[10px] font-black text-blue-200 uppercase tracking-widest"
            >
              Regenerate Today
            </button>
            <button
              onClick={() => void triggerPauseNow()}
              className="px-2.5 py-1 bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 rounded text-[10px] font-black text-amber-200 uppercase tracking-widest"
            >
              Pause Now
            </button>
            <button
              onClick={() => void triggerResumeNow()}
              className="px-2.5 py-1 bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/40 rounded text-[10px] font-black text-violet-200 uppercase tracking-widest"
            >
              Resume Now
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <label className="text-[11px] text-zinc-400 flex items-center gap-2">
            <input
              type="checkbox"
              checked={scheduleCfg?.enabled === true}
              onChange={(e) => setScheduleCfg((p: any) => ({ ...p, enabled: e.target.checked }))}
            />
            Enabled
          </label>
          <label className="text-[11px] text-zinc-400">
            Pause Start
            <input
              type="time"
              value={String(scheduleCfg?.pauseWindow?.start || '22:00')}
              onChange={(e) => setScheduleCfg((p: any) => ({ ...p, pauseWindow: { ...(p.pauseWindow || {}), start: e.target.value } }))}
              className="mt-1 w-full px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-zinc-200"
            />
          </label>
          <label className="text-[11px] text-zinc-400">
            Pause End
            <input
              type="time"
              value={String(scheduleCfg?.pauseWindow?.end || '23:30')}
              onChange={(e) => setScheduleCfg((p: any) => ({ ...p, pauseWindow: { ...(p.pauseWindow || {}), end: e.target.value } }))}
              className="mt-1 w-full px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-zinc-200"
            />
          </label>
          <label className="text-[11px] text-zinc-400">
            Resume Window
            <div className="mt-1 grid grid-cols-2 gap-2">
              <input
                type="time"
                value={String(scheduleCfg?.resumeWindow?.start || '08:30')}
                onChange={(e) => setScheduleCfg((p: any) => ({ ...p, resumeWindow: { ...(p.resumeWindow || {}), start: e.target.value } }))}
                className="px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-zinc-200"
              />
              <input
                type="time"
                value={String(scheduleCfg?.resumeWindow?.end || '10:00')}
                onChange={(e) => setScheduleCfg((p: any) => ({ ...p, resumeWindow: { ...(p.resumeWindow || {}), end: e.target.value } }))}
                className="px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-zinc-200"
              />
            </div>
          </label>
        </div>
        <div>
          <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-black mb-2">Resume Selected Bots</p>
          <div className="flex flex-wrap gap-2">
            {botOnline.map((b) => {
              const id = String(b.botId || '');
              const selected = Array.isArray(scheduleCfg?.resumeBotIds) && scheduleCfg.resumeBotIds.includes(id);
              return (
                <button
                  key={id}
                  onClick={() => setScheduleCfg((p: any) => {
                    const cur: string[] = Array.isArray(p?.resumeBotIds) ? [...p.resumeBotIds] : [];
                    return {
                      ...p,
                      resumeBotIds: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
                    };
                  })}
                  className={`px-2 py-1 rounded border text-[10px] font-black uppercase tracking-widest ${selected ? 'bg-blue-600/30 border-blue-500/50 text-blue-200' : 'bg-zinc-900 border-zinc-700 text-zinc-300'}`}
                >
                  {id}
                </button>
              );
            })}
          </div>
        </div>
        <p className="text-[11px] text-zinc-500">
          Today plan: {scheduleState?.pauseAt ? new Date(scheduleState.pauseAt).toLocaleTimeString() : '-'} pause, {scheduleState?.resumeAt ? new Date(scheduleState.resumeAt).toLocaleTimeString() : '-'} resume
        </p>
      </div>

      <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-4">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mr-2">Bot Control</p>
          <select
            value={selectedBotId}
            onChange={(e) => setSelectedBotId(e.target.value)}
            className="px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-[11px] text-zinc-200 min-w-[180px]"
          >
            {botOnline.map((b) => (
              <option key={String(b.botId)} value={String(b.botId)}>
                {String(b.botId)} ({String(b.status || 'unknown')})
              </option>
            ))}
          </select>
          <button
            onClick={() => void pauseBot()}
            disabled={!selectedBotId || botCtlLoading}
            className="px-2.5 py-1 bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 rounded text-[10px] font-black text-amber-200 uppercase tracking-widest disabled:opacity-50"
          >
            Pause
          </button>
          <button
            onClick={() => void resumeBot()}
            disabled={!selectedBotId || botCtlLoading}
            className="px-2.5 py-1 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 rounded text-[10px] font-black text-emerald-200 uppercase tracking-widest disabled:opacity-50"
          >
            Resume
          </button>
          <button
            onClick={() => void loadBotOnline()}
            className="px-2.5 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 rounded text-[10px] font-black text-zinc-300 uppercase tracking-widest flex items-center gap-1"
          >
            <RefreshCw className={cn('w-3 h-3', botCtlLoading && 'animate-spin')} />
            Refresh
          </button>
          <span className="text-[11px] text-zinc-400">
            {selectedBot ? `status=${selectedBot.status} staleMs=${selectedBot.staleMs}` : 'no bot selected'}
          </span>
          <button
            onClick={() => void pauseAll()}
            disabled={botCtlLoading || botOnline.length === 0}
            className="ml-auto px-2.5 py-1 bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 rounded text-[10px] font-black text-amber-200 uppercase tracking-widest disabled:opacity-50"
          >
            Pause All
          </button>
          <button
            onClick={() => void resumeAll()}
            disabled={botCtlLoading || botOnline.length === 0}
            className="px-2.5 py-1 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 rounded text-[10px] font-black text-emerald-200 uppercase tracking-widest disabled:opacity-50"
          >
            Resume All
          </button>
        </div>
        <div className="mt-3 max-h-48 overflow-auto pr-1">
          <table className="w-full text-[11px]">
            <thead className="text-zinc-500 uppercase tracking-widest">
              <tr>
                <th className="text-left py-2">Bot</th>
                <th className="text-left py-2">Status</th>
                <th className="text-left py-2">Current Work</th>
                <th className="text-left py-2">Accounts</th>
                <th className="text-right py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {botOnline.map((b) => (
                <tr key={String(b.botId)} className="border-t border-zinc-800">
                  <td className="py-2 text-zinc-200">{String(b.botId)}</td>
                  <td className="py-2 text-zinc-400">{String(b.status || '-')}</td>
                  <td className={`py-2 ${renderBotWork(b).tone}`}>{renderBotWork(b).label}</td>
                  <td className="py-2 text-zinc-500">{Array.isArray(b.accountIds) ? b.accountIds.join(', ') : '-'}</td>
                  <td className="py-2 text-right">
                    {String(b.status) === 'paused' ? (
                      <button
                        onClick={async () => {
                          try {
                            setBotCtlLoading(true);
                            await pauseResumeById(String(b.botId), 'resume');
                            toast.success(`Resumed ${String(b.botId)}`);
                            await loadBotOnline();
                          } catch {
                            toast.error('Resume failed');
                          } finally {
                            setBotCtlLoading(false);
                          }
                        }}
                        className="px-2 py-1 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 rounded text-[10px] font-black text-emerald-200 uppercase tracking-widest"
                      >
                        Resume
                      </button>
                    ) : (
                      <button
                        onClick={async () => {
                          try {
                            setBotCtlLoading(true);
                            await pauseResumeById(String(b.botId), 'pause');
                            toast.success(`Paused ${String(b.botId)}`);
                            await loadBotOnline();
                          } catch {
                            toast.error('Pause failed');
                          } finally {
                            setBotCtlLoading(false);
                          }
                        }}
                        className="px-2 py-1 bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 rounded text-[10px] font-black text-amber-200 uppercase tracking-widest"
                      >
                        Pause
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Bot Live Feed</p>
            <button onClick={() => void loadBotObservations()} className="px-2.5 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 rounded-lg text-[10px] font-black text-zinc-300 uppercase tracking-widest flex items-center gap-1">
              <RefreshCw className={cn('w-3 h-3', botObsLoading && 'animate-spin')} />
              Refresh
            </button>
          </div>
          <div className="max-h-72 overflow-auto space-y-2 pr-1">
            {botObservations.slice(0, 18).map((ob) => (
              <div key={ob.id} className="bg-zinc-950/70 border border-zinc-800 rounded-xl p-2.5 text-[11px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-black text-zinc-200">{ob.botId}</span>
                  <span className="text-zinc-500">{ob.createdAt ? new Date(ob.createdAt).toLocaleTimeString() : '-'}</span>
                </div>
                <div className="text-zinc-300 mt-1">@{String(ob.artistHandle || '-')} | mode {String(ob.mode || '-')}</div>
                <div className="text-zinc-500 mt-1">opened {Number(ob.summary?.opened || 0)} / media {Number(ob.summary?.totalMedia || 0)} / target {Number(ob.summary?.desiredOpenCount || 0)}</div>
                <div className="text-zinc-500 mt-1">
                  like {Number(ob.profileFacts?.likeSummary?.liked || 0)} / comment {Number(ob.profileFacts?.commentSummary?.posted || 0)} / follow {Number(ob.profileFacts?.followSummary?.followed || 0)}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-zinc-500">
                  <div>posts: <span className="text-zinc-300">{formatNum(ob.profileFacts?.postCount)}</span></div>
                  <div>followers: <span className="text-zinc-300">{formatNum(ob.profileFacts?.followers)}</span></div>
                  <div>following: <span className="text-zinc-300">{formatNum(ob.profileFacts?.following)}</span></div>
                  <div>lead/follow: <span className="text-zinc-300">{Number(ob.profileFacts?.leadScore || 0)} / {String(ob.profileFacts?.followPriority || 'n/a')}</span></div>
                  <div className="col-span-2">category: <span className="text-zinc-300">{String(ob.profileFacts?.categoryLabel || '-')}</span></div>
                  <div className="col-span-2">email: <span className="text-zinc-300">{String(ob.profileFacts?.email || (Array.isArray(ob.profileFacts?.emails) ? ob.profileFacts.emails.join(', ') : '-') || '-')}</span></div>
                  <div className="col-span-2">address: <span className="text-zinc-300">{String(ob.profileFacts?.profileAddress || '-')}</span></div>
                  <div className="col-span-2 break-all">url: <a href={String(ob.profileFacts?.externalUrl || `https://www.instagram.com/${String(ob.artistHandle || '').replace(/^@/, '')}/`)} target="_blank" rel="noreferrer" className="text-blue-400 hover:text-blue-300 underline">{String(ob.profileFacts?.externalUrl || `https://www.instagram.com/${String(ob.artistHandle || '').replace(/^@/, '')}/`)}</a></div>
                  <div className="col-span-2">styles/signal: <span className="text-zinc-300">{Array.isArray(ob.profileFacts?.categorySignals?.imagePositiveHits) ? ob.profileFacts.categorySignals.imagePositiveHits.slice(0, 5).join(', ') : '-'}</span></div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-4 space-y-3">
          <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Relationship Mapping (Shop - Bot - Interaction)</p>
          <div className="max-h-72 overflow-auto pr-1">
            <table className="w-full text-[11px]">
              <thead className="text-zinc-500 uppercase tracking-widest">
                <tr>
                  <th className="text-left py-2">Shop(IG)</th>
                  <th className="text-left py-2">Bots</th>
                  <th className="text-right py-2">Lead</th>
                  <th className="text-left py-2">Follow Queue</th>
                  <th className="text-right py-2">Visits</th>
                  <th className="text-right py-2">Opened</th>
                  <th className="text-right py-2">Media</th>
                </tr>
              </thead>
              <tbody>
                {relationshipRows.map((r) => (
                  <tr key={`${r.artistHandle}-${r.artistId}`} className="border-t border-zinc-800">
                    <td className="py-2 text-zinc-200">@{r.artistHandle}</td>
                    <td className="py-2 text-zinc-400">{Array.from(r.botIds).join(', ')}</td>
                    <td className="py-2 text-right text-zinc-200">{r.leadScore || 0}</td>
                    <td className="py-2 text-zinc-300">
                      <span className={cn(
                        "px-2 py-0.5 rounded border text-[10px] font-black uppercase tracking-widest",
                        r.followPriority === 'high' && "bg-emerald-600/20 border-emerald-500/40 text-emerald-200",
                        r.followPriority === 'medium' && "bg-amber-600/20 border-amber-500/40 text-amber-200",
                        r.followPriority === 'low' && "bg-zinc-700/40 border-zinc-600 text-zinc-300",
                        !r.followPriority && "bg-zinc-800/40 border-zinc-700 text-zinc-400"
                      )}>
                        {r.followPriority || 'n/a'}
                      </span>
                    </td>
                    <td className="py-2 text-right text-zinc-300">{r.visits}</td>
                    <td className="py-2 text-right text-zinc-300">{r.openedTotal}</td>
                    <td className="py-2 text-right text-zinc-500">{r.mediaTotal}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Manual Review - Non Tattoo Candidates</p>
          <button onClick={() => void loadReviewCandidates()} className="px-2.5 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 rounded-lg text-[10px] font-black text-zinc-300 uppercase tracking-widest flex items-center gap-1">
            <RefreshCw className={cn('w-3 h-3', reviewLoading && 'animate-spin')} />
            Refresh
          </button>
        </div>
        <div className="max-h-72 overflow-auto pr-1">
          <table className="w-full text-[11px]">
            <thead className="text-zinc-500 uppercase tracking-widest">
              <tr>
                <th className="text-left py-2">Handle</th>
                <th className="text-left py-2">Shop</th>
                <th className="text-left py-2">Signal</th>
                <th className="text-right py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {reviewCandidates.map((r) => (
                <tr key={`${r.observationId}-${r.artistHandle}`} className="border-t border-zinc-800">
                  <td className="py-2 text-zinc-200">@{r.artistHandle || '-'}</td>
                  <td className="py-2 text-zinc-300">{r.shopName || '-'}</td>
                  <td className="py-2 text-zinc-500">
                    <div>{r?.profileFacts?.categoryLabel || r?.profileFacts?.title || '-'}</div>
                    {r?.artistHandle ? (
                      <a href={`https://www.instagram.com/${String(r.artistHandle).replace(/^@/, '')}/`} target="_blank" rel="noreferrer" className="text-blue-400 hover:text-blue-300 underline break-all">
                        https://www.instagram.com/{String(r.artistHandle).replace(/^@/, '')}/
                      </a>
                    ) : null}
                  </td>
                  <td className="py-2 text-right">
                    <button onClick={() => void keepAndRequeueArtist(r)} className="px-2 py-1 mr-2 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 rounded text-[10px] font-black text-emerald-200 uppercase tracking-widest">Keep</button>
                    <button onClick={() => void deleteReviewArtist(r)} className="px-2 py-1 bg-red-600/20 hover:bg-red-600/30 border border-red-500/40 rounded text-[10px] font-black text-red-200 uppercase tracking-widest">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Kept Candidates</p>
          <button onClick={() => void loadKeptCandidates()} className="px-2.5 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 rounded-lg text-[10px] font-black text-zinc-300 uppercase tracking-widest flex items-center gap-1">
            <RefreshCw className='w-3 h-3' />
            Refresh
          </button>
        </div>
        <div className="max-h-56 overflow-auto pr-1">
          <table className="w-full text-[11px]">
            <thead className="text-zinc-500 uppercase tracking-widest">
              <tr>
                <th className="text-left py-2">Handle</th>
                <th className="text-left py-2">Shop</th>
                <th className="text-left py-2">Region</th>
                <th className="text-right py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {keptCandidates.map((r) => (
                <tr key={`${r.artistHandle}-${r.updatedAt}`} className="border-t border-zinc-800">
                  <td className="py-2 text-zinc-200">@{r.artistHandle || '-'}</td>
                  <td className="py-2 text-zinc-300">{r.shopName || '-'}</td>
                  <td className="py-2 text-zinc-500">{[r.city, r.importRegion].filter(Boolean).join(', ') || '-'}</td>
                  <td className="py-2 text-right">
                    <button onClick={() => void unkeepCandidate(r)} className="px-2 py-1 bg-zinc-700/30 hover:bg-zinc-700/50 border border-zinc-600/40 rounded text-[10px] font-black text-zinc-200 uppercase tracking-widest">
                      Unkeep
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
