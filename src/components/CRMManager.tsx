
import React, { useState, useMemo } from 'react';
import { 
  Users, 
  MessageCircle, 
  ShoppingBag, 
  Clock, 
  Search, 
  Filter, 
  ArrowUpRight, 
  MoreHorizontal, 
  Zap, 
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  History,
  UserPlus,
  Instagram,
  Heart,
  Sparkles,
  Loader2,
  ThumbsUp,
  ThumbsDown,
  Trash2,
  MapPin
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../lib/utils';
import { useCRM } from '../contexts/CRMContext';
import { CRMStage, CRMArtist } from '../types/crm';
import { toast } from 'sonner';
import { generatePersonaDMScript } from '../lib/gemini';

const STAGES: { id: CRMStage; label: string; icon: any; color: string }[] = [
  { id: 'outreach', label: 'New Leads', icon: Users, color: 'text-blue-500' },
  { id: 'engaged', label: 'Engaged Chats', icon: MessageCircle, color: 'text-amber-500' },
  { id: 'customers', label: 'Customers', icon: ShoppingBag, color: 'text-green-500' },
  { id: 'dormant', label: 'Dormant (90d+)', icon: Clock, color: 'text-rose-500' },
];

export default function CRMManager() {
  const { 
    artists, 
    moveArtist, 
    markAsConverted, 
    addInteraction, 
    persona,
    importCSV,
    deleteArtist,
    isScanning,
    setIsScanning,
    scanProgress,
    pinnedCount,
    submitFeedback
  } = useCRM();
  const [activeStage, setActiveStage] = useState<CRMStage>('outreach');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<string>('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [enrichFilter, setEnrichFilter] = useState<'all' | 'enriched' | 'no_data'>('all');
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const handleCSVImport = () => {
    // Mock CSV data
    const mockData = [
      { shopName: 'Ink Studio LA', mapsRating: '4.8', igLink: 'https://instagram.com/ink_la', address: 'Los Angeles, CA' },
      { shopName: 'Needle Art NYC', mapsRating: '4.5', igLink: 'https://instagram.com/needle_nyc', address: 'New York, NY' },
      { shopName: 'Black & Grey Pro', mapsRating: '4.9', igLink: 'https://instagram.com/bg_pro', address: 'Berlin, DE' },
      { shopName: 'Traditional King', mapsRating: '4.2', igLink: 'https://instagram.com/trad_king', address: 'London, UK' },
      { shopName: 'Realism Expert', mapsRating: '4.7', igLink: 'https://instagram.com/realism_exp', address: 'Paris, FR' },
    ];
    importCSV(mockData);
  };

  const handleGenerateScript = async (artist: CRMArtist) => {
    setGeneratingFor(artist.id);
    try {
      const script = await generatePersonaDMScript(artist.fullName, artist.dnaTags, persona);
      toast.success(`AI Script for @${artist.username}:`, {
        description: script,
        duration: 10000,
        action: {
          label: 'Copy',
          onClick: () => navigator.clipboard.writeText(script)
        }
      });
    } catch (error) {
      toast.error('Failed to generate script');
    } finally {
      setGeneratingFor(null);
    }
  };

  const filteredArtists = useMemo(() => {
    let list = artists.filter(a => a.stage === activeStage);
    
    if (searchQuery) {
      list = list.filter(a =>
        a.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
        a.fullName.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Enrichment filter
    if (enrichFilter === 'enriched') {
      list = list.filter(a => (a.followers ?? 0) > 0);
    } else if (enrichFilter === 'no_data') {
      list = list.filter(a => !a.followers || a.followers === 0);
    }

    // Apply sorting
    if (sortField) {
      list.sort((a, b) => {
        let av: any, bv: any;
        switch (sortField) {
          case 'followers': av = a.followers ?? 0; bv = b.followers ?? 0; break;
          case 'rating': av = a.rating ?? a.mapsRating ?? 0; bv = b.rating ?? b.mapsRating ?? 0; break;
          case 'heatScore': av = a.heatScore ?? 0; bv = b.heatScore ?? 0; break;
          case 'similarityScore': av = a.similarityScore ?? 0; bv = b.similarityScore ?? 0; break;
          case 'name': av = a.fullName || ''; bv = b.fullName || ''; break;
          case 'location': av = a.location || ''; bv = b.location || ''; break;
          default: av = a[sortField as keyof CRMArtist]; bv = b[sortField as keyof CRMArtist];
        }
        if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
        return sortDir === 'asc' ? (av - bv) : (bv - av);
      });
    } else {
      // Default sorting
      if (activeStage === 'outreach') {
        list.sort((a, b) => {
          if (a.isRecommended && !b.isRecommended) return -1;
          if (!a.isRecommended && b.isRecommended) return 1;
          return (b.heatScore + b.similarityScore) - (a.heatScore + a.similarityScore);
        });
      } else if (activeStage === 'customers') {
        list.sort((a, b) => (b.orderCount || 0) - (a.orderCount || 0));
      }
    }

    return list;
  }, [artists, activeStage, searchQuery, enrichFilter, sortField, sortDir]);

  const paginatedArtists = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredArtists.slice(start, start + itemsPerPage);
  }, [filteredArtists, currentPage]);

  const totalPages = Math.ceil(filteredArtists.length / itemsPerPage);

  // Reset page when filters change
  React.useEffect(() => {
    setCurrentPage(1);
  }, [activeStage, searchQuery, enrichFilter]);

  const stats = useMemo(() => {
    return {
      outreach: artists.filter(a => a.stage === 'outreach').length,
      engaged: artists.filter(a => a.stage === 'engaged').length,
      customers: artists.filter(a => a.stage === 'customers').length,
      dormant: artists.filter(a => a.stage === 'dormant').length,
    };
  }, [artists]);

  return (
    <div className="space-y-8">
      {/* Funnel Stats */}
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

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {STAGES.map((stage) => {
          const Icon = stage.icon;
          const isActive = activeStage === stage.id;
          return (
            <button
              key={stage.id}
              onClick={() => setActiveStage(stage.id)}
              className={cn(
                "p-6 rounded-[2rem] border transition-all duration-300 text-left relative overflow-hidden group",
                isActive 
                  ? "bg-[#111] border-rose-500/50 shadow-lg shadow-rose-600/10" 
                  : "bg-[#111] border-zinc-800/50 hover:border-zinc-700"
              )}
            >
              <div className={cn(
                "absolute top-0 right-0 w-32 h-32 blur-[60px] -mr-16 -mt-16 rounded-full opacity-20 transition-opacity",
                isActive ? "opacity-40" : "group-hover:opacity-30",
                stage.id === 'outreach' ? "bg-blue-600" :
                stage.id === 'engaged' ? "bg-amber-600" :
                stage.id === 'customers' ? "bg-green-600" : "bg-rose-600"
              )} />
              
              <div className="relative z-10 flex flex-col gap-4">
                <div className={cn(
                  "w-12 h-12 rounded-2xl flex items-center justify-center border",
                  isActive ? "bg-rose-600/10 border-rose-500/20" : "bg-zinc-900 border-zinc-800"
                )}>
                  <Icon className={cn("w-6 h-6", isActive ? "text-rose-500" : "text-zinc-500")} />
                </div>
                <div>
                  <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">{stage.label}</p>
                  <h4 className="text-3xl font-black text-white mt-1">
                    {stage.id === 'outreach' 
                      ? (stats.outreach > 0 ? stats.outreach.toLocaleString() : '50,000+') 
                      : stats[stage.id as keyof typeof stats].toLocaleString()}
                  </h4>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* List Area */}
      <div className="bg-[#111] border border-zinc-800/50 rounded-[2.5rem] overflow-hidden">
        <div className="p-8 border-b border-zinc-800/50 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
            <input 
              type="text"
              placeholder="Search artists, handles or tags..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-6 py-4 bg-zinc-900 border border-zinc-800 focus:border-rose-500 rounded-2xl outline-none transition-all text-sm font-medium"
            />
          </div>
          
            <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-2xl p-1">
              <button
                onClick={() => setEnrichFilter('all')}
                className={cn(
                  "px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                  enrichFilter === 'all' ? "bg-rose-600 text-white shadow" : "text-zinc-500 hover:text-zinc-300"
                )}
              >
                All
              </button>
              <button
                onClick={() => setEnrichFilter('enriched')}
                className={cn(
                  "px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5",
                  enrichFilter === 'enriched' ? "bg-green-600 text-white shadow" : "text-zinc-500 hover:text-zinc-300"
                )}
              >
                <CheckCircle2 className="w-3 h-3" />
                Enriched
              </button>
              <button
                onClick={() => setEnrichFilter('no_data')}
                className={cn(
                  "px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5",
                  enrichFilter === 'no_data' ? "bg-zinc-600 text-white shadow" : "text-zinc-500 hover:text-zinc-300"
                )}
              >
                <AlertCircle className="w-3 h-3" />
                No Data
              </button>
            </div>
            {activeStage === 'outreach' && (
              <button 
                onClick={handleCSVImport}
                disabled={isScanning}
                className="px-6 py-4 bg-rose-600 hover:bg-rose-500 text-white rounded-2xl text-sm font-black flex items-center gap-3 transition-all shadow-lg shadow-rose-600/20 disabled:opacity-50"
              >
                {isScanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                Smart Import & Learning
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-zinc-800/50">
                <th className="px-8 py-6 text-[10px] font-black text-zinc-500 uppercase tracking-widest cursor-pointer select-none hover:text-zinc-300 transition-colors" onClick={() => handleSort('name')}>
                  Artist Profile {sortField === 'name' && (sortDir === 'asc' ? '↑' : '↓')}
                </th>
                <th className="px-8 py-6 text-[10px] font-black text-zinc-500 uppercase tracking-widest cursor-pointer select-none hover:text-zinc-300 transition-colors" onClick={() => handleSort('followers')}>
                  Followers {sortField === 'followers' && (sortDir === 'asc' ? '↑' : '↓')}
                </th>
                <th className="px-8 py-6 text-[10px] font-black text-zinc-500 uppercase tracking-widest cursor-pointer select-none hover:text-zinc-300 transition-colors" onClick={() => handleSort('heatScore')}>
                  Score {sortField === 'heatScore' && (sortDir === 'asc' ? '↑' : '↓')}
                </th>
                <th className="px-8 py-6 text-[10px] font-black text-zinc-500 uppercase tracking-widest cursor-pointer select-none hover:text-zinc-300 transition-colors" onClick={() => handleSort('rating')}>
                  Rating {sortField === 'rating' && (sortDir === 'asc' ? '↑' : '↓')}
                </th>
                <th className="px-8 py-6 text-[10px] font-black text-zinc-500 uppercase tracking-widest cursor-pointer select-none hover:text-zinc-300 transition-colors" onClick={() => handleSort('similarityScore')}>
                  Similarity {sortField === 'similarityScore' && (sortDir === 'asc' ? '↑' : '↓')}
                </th>
                <th className="px-8 py-6 text-[10px] font-black text-zinc-500 uppercase tracking-widest text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence mode="popLayout">
                {paginatedArtists.map((artist) => (
                  <motion.tr
                    key={artist.id}
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="group border-b border-zinc-800/30 hover:bg-zinc-900/20 transition-colors"
                  >
                    {/* Col 1: Artist Profile */}
                    <td className="px-8 py-6">
                      <div className="flex items-center gap-4">
                        <img
                          src={artist.profilePic}
                          alt={artist.username}
                          className="w-12 h-12 rounded-2xl border border-zinc-800 object-cover"
                          referrerPolicy="no-referrer"
                        />
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-black text-white">
                              @{(!artist.username || artist.username.startsWith('user_')) ? (artist.fullName || 'artist').toLowerCase().replace(/\s+/g, '_') : artist.username}
                            </p>
                            {artist.style && (
                              <span className="px-2 py-0.5 bg-zinc-800 text-[8px] font-black rounded-full text-zinc-500 uppercase tracking-widest">
                                {artist.style}
                              </span>
                            )}
                            <span className={cn(
                              "px-2 py-0.5 text-[8px] font-black rounded-full uppercase tracking-widest border",
                              artist.stage === 'customers' ? "bg-green-500/10 text-green-500 border-green-500/20" :
                              artist.stage === 'engaged' ? "bg-blue-500/10 text-blue-500 border-blue-500/20" :
                              "bg-zinc-800 text-zinc-400 border-zinc-700"
                            )}>
                              {artist.stage}
                            </span>
                            {artist.isHighIntent && (
                              <span className="px-2 py-0.5 bg-red-600 text-[8px] font-black rounded-full animate-pulse">
                                HIGH INTENT
                              </span>
                            )}
                            {artist.isRecommended && (
                              <span className="px-2 py-0.5 bg-amber-500 text-[8px] font-black text-black rounded-full">
                                RECOMMENDED SIMILARITY
                              </span>
                            )}
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <p className="text-xs text-zinc-400 font-bold">{artist.fullName || 'Unknown Artist'}</p>
                            <div className="flex items-center gap-3 mt-1">
                              <span className="text-[10px] font-bold text-zinc-500 flex items-center gap-1">
                                <MapPin className="w-3 h-3 text-zinc-600" />
                                {artist.location || 'No Location'}{artist.country ? `, ${artist.country}` : ''}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Col 2: Followers + Enrichment Status */}
                    <td className="px-8 py-6">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className="text-lg font-black text-white">
                            {artist.followers ? artist.followers.toLocaleString() : '—'}
                          </span>
                        </div>
                        {artist.followers && artist.followers > 0 ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-500/10 text-green-500 border border-green-500/20 text-[8px] font-black rounded-full uppercase tracking-widest w-fit">
                            <CheckCircle2 className="w-2.5 h-2.5" />
                            ENRICHED
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-zinc-800 text-zinc-500 text-[8px] font-black rounded-full uppercase tracking-widest w-fit">
                            <AlertCircle className="w-2.5 h-2.5" />
                            NO DATA
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Col 3: Score */}
                    <td className="px-8 py-6">
                      {activeStage === 'outreach' ? (
                        <div className="space-y-1">
                          <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Base Score</p>
                          <span className="text-lg font-black text-rose-500">{artist.baseScore || 0}</span>
                        </div>
                      ) : activeStage === 'customers' ? (
                        <div className="space-y-1">
                          <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Tier & Orders</p>
                          <div className="flex items-center gap-2">
                            <span className={cn(
                              "px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest",
                              artist.customerTier === 'loyal' ? "bg-green-500 text-black" : "bg-zinc-800 text-zinc-400"
                            )}>
                              {artist.customerTier === 'loyal' ? 'Loyal' : 'New'}
                            </span>
                            <span className="text-sm font-black text-white">{artist.orderCount} Orders</span>
                            {artist.totalSpent !== undefined && (
                              <span className="text-xs font-black text-rose-500 ml-2">
                                ${artist.totalSpent.toLocaleString()}
                              </span>
                            )}
                          </div>
                          {artist.lastOrderDate && (
                            (() => {
                              const lastOrder = new Date(artist.lastOrderDate!);
                              const today = new Date();
                              const diffDays = Math.floor((today.getTime() - lastOrder.getTime()) / (1000 * 3600 * 24));
                              if (diffDays >= 40 && diffDays <= 60) {
                                return (
                                  <div className="flex items-center gap-1 mt-1 px-2 py-0.5 bg-amber-500/10 border border-amber-500/20 rounded text-[8px] font-black text-amber-500 animate-pulse w-fit">
                                    <AlertCircle className="w-2 h-2" />
                                    RESTOCK (D+{diffDays})
                                  </div>
                                );
                              }
                              return null;
                            })()
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-3">
                          <History className="w-4 h-4 text-zinc-500" />
                          <span className="text-xs text-zinc-400">{new Date(artist.lastInteractionDate).toLocaleDateString()}</span>
                        </div>
                      )}
                    </td>

                    {/* Col 4: Rating */}
                    <td className="px-8 py-6">
                      {activeStage === 'outreach' ? (
                        <div className="space-y-1">
                          <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Maps Rating</p>
                          <div className="flex items-center gap-1">
                            <span className="text-lg font-black text-amber-500">{artist.mapsRating || artist.rating || '—'}</span>
                            {(artist.mapsRating || artist.rating) && (
                              <span className="text-amber-500 text-lg">★</span>
                            )}
                          </div>
                        </div>
                      ) : activeStage === 'customers' ? (
                        <div className="space-y-1">
                          <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Last Order</p>
                          <p className="text-sm text-zinc-400">{artist.lastOrderDate ? new Date(artist.lastOrderDate).toLocaleDateString() : '—'}</p>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Last Active</p>
                          <p className="text-sm text-zinc-400">{new Date(artist.lastInteractionDate).toLocaleDateString()}</p>
                        </div>
                      )}
                    </td>

                    {/* Col 5: Similarity + Heat */}
                    <td className="px-8 py-6">
                      {activeStage === 'outreach' ? (
                        <div className="space-y-3">
                          <div className="space-y-1">
                            <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Intent Heat</p>
                            <div className="flex items-center gap-2">
                              <div className="w-20 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                                <div
                                  className={cn(
                                    "h-full rounded-full transition-all duration-1000",
                                    artist.heatScore >= 80 ? "bg-rose-500" : artist.heatScore >= 50 ? "bg-amber-500" : "bg-blue-500"
                                  )}
                                  style={{ width: `${artist.heatScore}%` }}
                                />
                              </div>
                              <span className="text-xs font-black text-zinc-300">{artist.heatScore}</span>
                            </div>
                          </div>
                          <div className="space-y-1">
                            <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Similarity</p>
                            <div className="flex items-center gap-2">
                              <TrendingUp className="w-3 h-3 text-green-500" />
                              <span className="text-sm font-black text-zinc-300">{artist.similarityScore}%</span>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className={cn(
                          "inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-[10px] font-black uppercase tracking-widest",
                          activeStage === 'engaged' ? "bg-amber-500/10 border-amber-500/20 text-amber-500" :
                          activeStage === 'customers' ? "bg-green-500/10 border-green-500/20 text-green-500" :
                          "bg-rose-500/10 border-rose-500/20 text-rose-500"
                        )}>
                          {activeStage === 'engaged' && <MessageCircle className="w-3 h-3" />}
                          {activeStage === 'customers' && <CheckCircle2 className="w-3 h-3" />}
                          {activeStage === 'dormant' && <AlertCircle className="w-3 h-3" />}
                          {activeStage === 'engaged' ? 'Engaged' :
                           activeStage === 'customers' ? (artist.customerTier === 'loyal' ? 'Loyal Customer' : 'New Customer') : 'To Re-engage'}
                        </div>
                      )}
                    </td>

                    {/* Col 6: Actions */}
                    <td className="px-8 py-6 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {(activeStage === 'outreach' || activeStage === 'engaged') && (
                          <button
                            onClick={() => handleGenerateScript(artist)}
                            disabled={generatingFor === artist.id}
                            className="p-3 bg-rose-600/10 border border-rose-500/20 hover:bg-rose-600 hover:text-white text-rose-500 rounded-xl transition-all disabled:opacity-50"
                            title="One-click AI Script"
                          >
                            {generatingFor === artist.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Sparkles className="w-4 h-4" />
                            )}
                          </button>
                        )}
                        {activeStage === 'outreach' && (
                          <>
                            <button
                              onClick={() => addInteraction(artist.id, 'story-view')}
                              className="p-3 bg-zinc-900 border border-zinc-800 hover:border-red-500/50 hover:text-red-500 rounded-xl transition-all group/btn"
                              title="Simulate Story View (+5)"
                            >
                              <Instagram className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => addInteraction(artist.id, 'like')}
                              className="p-3 bg-zinc-900 border border-zinc-800 hover:border-rose-500/50 hover:text-rose-500 rounded-xl transition-all group/btn"
                              title="Simulate Like (+5)"
                            >
                              <Heart className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => addInteraction(artist.id, 'reply')}
                              className="p-3 bg-zinc-900 border border-zinc-800 hover:border-amber-500/50 hover:text-amber-500 rounded-xl transition-all group/btn"
                              title="Simulate Reply (+20)"
                            >
                              <MessageCircle className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => addInteraction(artist.id, 'follow-back')}
                              className="p-3 bg-zinc-900 border border-zinc-800 hover:border-blue-500/50 hover:text-blue-500 rounded-xl transition-all group/btn"
                              title="Simulate Follow Back (+40)"
                            >
                              <UserPlus className="w-4 h-4" />
                            </button>
                          </>
                        )}
                        {activeStage === 'engaged' && (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => submitFeedback(artist.id, 'success')}
                              className="p-3 bg-green-600/10 border border-green-500/20 hover:bg-green-600 hover:text-white text-green-500 rounded-xl transition-all"
                              title="Success / Converted"
                            >
                              <ThumbsUp className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => submitFeedback(artist.id, 'failure')}
                              className="p-3 bg-rose-600/10 border border-rose-500/20 hover:bg-rose-600 hover:text-white text-rose-500 rounded-xl transition-all"
                              title="Failed / Ignored"
                            >
                              <ThumbsDown className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                        {activeStage === 'dormant' && (
                          <button
                            onClick={() => moveArtist(artist.id, 'engaged')}
                            className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-black rounded-xl transition-all shadow-lg shadow-rose-600/20 flex items-center gap-2"
                          >
                            <Zap className="w-4 h-4" />
                            Re-engage Now
                          </button>
                        )}
                        <button
                          onClick={() => {
                            if (confirmDeleteId === artist.id) {
                              deleteArtist(artist.id);
                              setConfirmDeleteId(null);
                            } else {
                              setConfirmDeleteId(artist.id);
                              setTimeout(() => setConfirmDeleteId(null), 2000);
                            }
                          }}
                          className={cn(
                            "p-3 border rounded-xl transition-all flex items-center gap-2",
                            confirmDeleteId === artist.id
                              ? "bg-rose-600 border-rose-500 text-white scale-105 shadow-lg shadow-rose-600/20"
                              : "bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-rose-500 hover:border-rose-500/30"
                          )}
                          title={confirmDeleteId === artist.id ? "Click again to confirm delete" : "Delete Artist"}
                        >
                          <Trash2 className={cn("w-4 h-4", confirmDeleteId === artist.id && "animate-pulse")} />
                          {confirmDeleteId === artist.id && (
                            <span className="text-[10px] font-black uppercase tracking-tighter">Confirm</span>
                          )}
                        </button>
                        <button className="p-3 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-xl transition-all">
                          <MoreHorizontal className="w-4 h-4 text-zinc-500" />
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-8 py-4 border-t border-zinc-800 bg-zinc-900/30">
            <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">
              Showing {(currentPage - 1) * itemsPerPage + 1} - {Math.min(currentPage * itemsPerPage, filteredArtists.length)} of {filteredArtists.length}
            </span>
            <div className="flex items-center gap-4">
              <button
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className="px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-[10px] font-black text-zinc-400 uppercase tracking-widest disabled:opacity-30 transition-all"
              >
                Prev
              </button>
              <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">
                {currentPage} / {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
                className="px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-[10px] font-black text-zinc-400 uppercase tracking-widest disabled:opacity-30 transition-all"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
