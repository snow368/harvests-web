import React, { useMemo } from 'react';
import { toast } from 'sonner';
import { useCRM } from '../contexts/CRMContext';

const norm = (v: any) => String(v || '').toLowerCase();

export default function AnalyzerBusinessPanels() {
  const { artists, updateArtist } = useCRM();

  const distributorCandidates = useMemo(() => {
    const keys = ['tattoo supply', 'distributor', 'wholesale', 'pro team', 'studio owner', 'ink', 'needle'];
    return artists
      .filter((a: any) => {
        const meta = a?.metadata || {};
        if (meta.distributorExcluded) return false;
        const text = `${a.shopName} ${a.fullName} ${a.username} ${a.bio} ${a.website}`.toLowerCase();
        return meta.isDistributor === true || keys.some((k) => text.includes(k));
      })
      .slice(0, 30);
  }, [artists]);

  const referralReady = useMemo(() => {
    return artists
      .filter((a: any) => {
        const interactions = Number(a?.stats?.interactions || 0);
        const replies = Number(a?.socialSignals?.replyRate || 0);
        return interactions >= 3 || replies >= 5;
      })
      .slice(0, 30);
  }, [artists]);

  const lifecycle = useMemo(() => {
    const base = { sample_sent: [] as any[], bad_feedback: [] as any[], positive_no_order: [] as any[], one_order_stalled: [] as any[] };
    for (const a of artists) {
      const x = String(a?.metadata?.distributorLifecycle || '');
      if (x === 'sample_sent') base.sample_sent.push(a);
      else if (x === 'bad_feedback') base.bad_feedback.push(a);
      else if (x === 'positive_no_order') base.positive_no_order.push(a);
      else if (x === 'one_order_stalled') base.one_order_stalled.push(a);
    }
    return base;
  }, [artists]);

  return (
    <div className="space-y-4">
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-4">
        <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-3">Distributor Board</p>
        <div className="space-y-2 max-h-64 overflow-auto pr-1">
          {distributorCandidates.map((a: any) => (
            <div key={a.id} className="p-2.5 rounded-xl border border-zinc-800 bg-zinc-950/60 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-bold text-zinc-200 truncate">{a.shopName || a.fullName || a.username}</p>
                <p className="text-[10px] text-zinc-500 truncate">{a.ig_handle || '-'} | {a.city || '-'}, {a.state || a.country || '-'}</p>
              </div>
              <button
                onClick={async () => {
                  await updateArtist(a.id, { metadata: { ...(a.metadata || {}), isDistributor: true, distributorStatus: 'qualified' } as any });
                  toast.success('Marked as distributor');
                }}
                className="px-2 py-1 text-[10px] font-black uppercase tracking-widest rounded border border-emerald-500/40 text-emerald-200 bg-emerald-600/20"
              >
                Qualify
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-4">
        <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-3">Referral Queue</p>
        <div className="space-y-2 max-h-64 overflow-auto pr-1">
          {referralReady.map((a: any) => (
            <div key={a.id} className="p-2.5 rounded-xl border border-zinc-800 bg-zinc-950/60 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-bold text-zinc-200 truncate">{a.shopName || a.fullName || a.username}</p>
                <p className="text-[10px] text-zinc-500 truncate">replyRate {Number(a?.socialSignals?.replyRate || 0).toFixed(1)} | interactions {Number(a?.stats?.interactions || 0)}</p>
              </div>
              <button
                onClick={async () => {
                  await updateArtist(a.id, { metadata: { ...(a.metadata || {}), referralStatus: 'requested' } as any });
                  toast.success('Marked referral requested');
                }}
                className="px-2 py-1 text-[10px] font-black uppercase tracking-widest rounded border border-amber-500/40 text-amber-200 bg-amber-600/20"
              >
                Request
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-4">
        <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-3">Lifecycle Buckets</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px]">
          <div className="p-3 bg-zinc-950/60 border border-zinc-800 rounded-xl">
            <p className="text-zinc-500 uppercase tracking-widest text-[10px]">sample_sent</p>
            <p className="text-emerald-300 text-lg font-black">{lifecycle.sample_sent.length}</p>
          </div>
          <div className="p-3 bg-zinc-950/60 border border-zinc-800 rounded-xl">
            <p className="text-zinc-500 uppercase tracking-widest text-[10px]">bad_feedback</p>
            <p className="text-rose-300 text-lg font-black">{lifecycle.bad_feedback.length}</p>
          </div>
          <div className="p-3 bg-zinc-950/60 border border-zinc-800 rounded-xl">
            <p className="text-zinc-500 uppercase tracking-widest text-[10px]">positive_no_order</p>
            <p className="text-blue-300 text-lg font-black">{lifecycle.positive_no_order.length}</p>
          </div>
          <div className="p-3 bg-zinc-950/60 border border-zinc-800 rounded-xl">
            <p className="text-zinc-500 uppercase tracking-widest text-[10px]">one_order_stalled</p>
            <p className="text-amber-300 text-lg font-black">{lifecycle.one_order_stalled.length}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

