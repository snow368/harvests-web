import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  MessageSquare, 
  Users, 
  MapPin,
  Flame, 
  ChevronRight, 
  CheckCircle2, 
  Clock,
  Search,
  Filter,
  MoreHorizontal,
  Send,
  UserPlus,
  ThumbsUp,
  ThumbsDown,
  XCircle,
  Trash2,
  Sparkles,
  Loader2,
  RefreshCw
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useCRM } from '../contexts/CRMContext';
import { CRMArtist, CRMStage } from '../types/crm';
import { toast } from 'sonner';

const HeatMeter = ({ score }: { score: number }) => {
  const isHigh = score >= 80;
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="relative w-12 h-12 flex items-center justify-center">
      <svg className="w-full h-full -rotate-90">
        <circle
          cx="24"
          cy="24"
          r={radius}
          stroke="currentColor"
          strokeWidth="3"
          fill="transparent"
          className="text-zinc-800"
        />
        <circle
          cx="24"
          cy="24"
          r={radius}
          stroke="currentColor"
          strokeWidth="3"
          fill="transparent"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={cn(
            "transition-all duration-1000",
            isHigh ? "text-red-600 drop-shadow-[0_0_8px_rgba(220,38,38,0.6)]" : "text-rose-600"
          )}
        />
      </svg>
      <span className={cn(
        "absolute text-[10px] font-black",
        isHigh ? "text-red-600" : "text-zinc-400"
      )}>
        {score}
      </span>
    </div>
  );
};

export default function DualListManager() {
  const { artists, addInteraction, submitFeedback, deleteArtist, persona, loadData } = useCRM();
  const [activeTab, setActiveTab] = useState<CRMStage>('outreach');
  const [searchQuery, setSearchQuery] = useState('');
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 25;

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadData();
    setIsRefreshing(false);
    toast.success("Data synchronized with cloud");
  };

  const filteredArtists = artists.filter(a => {
    if (!a) return false;
    const matchesTab = a.stage === activeTab;
    const username = (a.username || '').toLowerCase();
    const matchesSearch = username.includes(searchQuery.toLowerCase());
    return matchesTab && matchesSearch;
  });

  const paginatedArtists = filteredArtists.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const totalPages = Math.ceil(filteredArtists.length / itemsPerPage);

  // Reset page when filters change
  React.useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, searchQuery]);

  const tabs: { id: CRMStage; label: string; icon: any }[] = [
    { id: 'outreach', label: 'New Leads', icon: UserPlus },
    { id: 'engaged', label: 'Active Engaged', icon: MessageSquare },
    { id: 'customers', label: 'Customers', icon: ThumbsUp },
    { id: 'dormant', label: 'Dormant', icon: XCircle },
  ];

  const handleMarkAsReplied = (id: string) => {
    addInteraction(id, 'reply');
  };

  const handleDelete = (artist: CRMArtist) => {
    if (confirmDeleteId === artist.id) {
      deleteArtist(artist.id);
      setConfirmDeleteId(null);
    } else {
      setConfirmDeleteId(artist.id);
      setTimeout(() => setConfirmDeleteId(null), 2000);
    }
  };

  const cleanDisplay = (text: any) => {
    if (typeof text !== 'string') return String(text || '');
    return text.replace(/\uFFFD/g, '');
  };

  return (
    <div className="flex flex-col h-full bg-black text-white font-sans selection:bg-rose-500/30">
      {/* Header & Tabs */}
      <div className="p-8 border-b border-zinc-800/50 bg-zinc-900/20 backdrop-blur-xl sticky top-0 z-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-3xl font-black tracking-tighter text-white flex items-center gap-3">
              <Users className="w-8 h-8 text-rose-500" />
              CRM Pipeline
            </h2>
            <p className="text-zinc-500 text-sm font-medium mt-1">Manage your outreach and active conversations.</p>
          </div>
          
          <div className="flex items-center gap-4">
            <button 
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="p-3 bg-zinc-900 border border-zinc-800 rounded-2xl text-zinc-400 hover:text-white transition-colors flex items-center gap-2"
              title="Sync with Cloud"
            >
              <RefreshCw className={cn("w-5 h-5", isRefreshing && "animate-spin")} />
            </button>
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input 
                type="text"
                placeholder="Search artists..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-11 pr-6 py-3 bg-zinc-900/50 border border-zinc-800 rounded-2xl text-sm focus:outline-none focus:border-rose-500/50 transition-all w-64"
              />
            </div>
            <button className="p-3 bg-zinc-900 border border-zinc-800 rounded-2xl text-zinc-400 hover:text-white transition-colors">
              <Filter className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex p-1.5 bg-zinc-900/50 rounded-[1.25rem] border border-zinc-800/50 w-fit overflow-x-auto">
          {tabs.map(tab => (
            <button 
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center gap-3 whitespace-nowrap",
                activeTab === tab.id ? "bg-rose-600 text-white shadow-lg shadow-rose-600/20" : "text-zinc-500 hover:text-zinc-300"
              )}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
              <span className="px-2 py-0.5 bg-black/20 rounded-full text-[10px]">
                {artists.filter(a => a && a.stage === tab.id).length}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Pagination Controls - New */}
      {totalPages > 1 && (
        <div className="px-8 py-3 bg-zinc-900/40 border-b border-zinc-800/50 flex items-center justify-between">
          <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">
            Showing {(currentPage - 1) * itemsPerPage + 1} - {Math.min(currentPage * itemsPerPage, filteredArtists.length)} of {filteredArtists.length}
          </p>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-[10px] font-black rounded-xl transition-all"
            >
              Previous
            </button>
            <span className="text-[10px] font-black text-rose-500 px-4">Page {currentPage} / {totalPages}</span>
            <button 
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-[10px] font-black rounded-xl transition-all"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Content Area */}
      <div className="flex-1 overflow-hidden relative">
        <AnimatePresence mode="wait">
          <motion.div 
            key={`${activeTab}-${currentPage}`} // Keys to trigger transition on page change
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="h-full overflow-y-auto p-8"
          >
            <div className="grid grid-cols-1 gap-4">
              {paginatedArtists.map((artist) => (
                <motion.div 
                  layout
                  key={artist.id}
                  className="group bg-zinc-900/30 border border-zinc-800/50 p-6 rounded-3xl hover:border-rose-500/30 transition-all flex items-center justify-between"
                >
                  <div className="flex items-center gap-6">
                    <img 
                      src={artist.profilePic || `https://picsum.photos/seed/${artist.username}/100/100`} 
                      alt={artist.username} 
                      className="w-16 h-16 rounded-2xl border border-zinc-800 object-cover"
                      referrerPolicy="no-referrer"
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-lg font-black text-white">
                          @{cleanDisplay((!artist.username || typeof artist.username !== 'string' || artist.username.startsWith('user_')) ? (artist.fullName || 'artist').toLowerCase().replace(/\s+/g, '_') : artist.username)}
                        </h4>
                        {artist.style && (
                          <span className="px-2 py-0.5 bg-zinc-800 text-[8px] font-black rounded-full text-zinc-500 uppercase tracking-widest">
                            {cleanDisplay(artist.style)}
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
                      </div>
                      <div className="flex flex-col gap-0.5 mt-1">
                        <p className="text-xs text-zinc-400 font-bold">{cleanDisplay(artist.fullName || 'Unknown Artist')}</p>
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] text-zinc-500 font-bold flex items-center gap-1">
                            <MapPin className="w-3 h-3 text-zinc-600" />
                            {cleanDisplay(artist.location || 'No Location')}{artist.country ? `, ${cleanDisplay(artist.country)}` : ''}
                          </span>
                          <span className="text-[10px] text-rose-500/80 font-black flex items-center gap-1">
                            <Users className="w-3 h-3" />
                            {artist.followers && typeof artist.followers === 'number' ? artist.followers.toLocaleString() : (artist.followers || '0')}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-center">
                      <p className="text-[10px] font-black text-zinc-600 uppercase mb-1">Heat</p>
                      <HeatMeter score={artist.heatScore} />
                    </div>
                    
                    <div className="flex items-center gap-2">
                      {activeTab === 'outreach' && (
                        <button 
                          onClick={() => handleMarkAsReplied(artist.id)}
                          className="px-4 py-2 bg-amber-600/10 border border-amber-500/20 text-amber-500 hover:bg-amber-600 hover:text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                        >
                          Mark as Replied
                        </button>
                      )}

                      {activeTab === 'engaged' && (
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => submitFeedback(artist.id, 'success')}
                            className="p-2 bg-green-600/10 border border-green-500/20 text-green-500 hover:bg-green-600 hover:text-white rounded-xl transition-all"
                            title="Converted"
                          >
                            <ThumbsUp className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => submitFeedback(artist.id, 'failure')}
                            className="p-2 bg-rose-600/10 border border-rose-500/20 text-rose-500 hover:bg-rose-600 hover:text-white rounded-xl transition-all"
                            title="Not Interested"
                          >
                            <ThumbsDown className="w-4 h-4" />
                          </button>
                        </div>
                      )}

                      <button 
                        onClick={() => handleDelete(artist)}
                        className={cn(
                          "p-2 border rounded-xl transition-all flex items-center gap-2",
                          confirmDeleteId === artist.id 
                            ? "bg-rose-600 border-rose-500 text-white scale-105 shadow-lg shadow-rose-600/20" 
                            : "bg-zinc-800 border-transparent text-zinc-500 hover:text-rose-500 hover:border-rose-500/30"
                        )}
                        title={confirmDeleteId === artist.id ? "Click again to confirm delete" : "Delete"}
                      >
                        <Trash2 className={cn("w-4 h-4", confirmDeleteId === artist.id && "animate-pulse")} />
                        {confirmDeleteId === artist.id && (
                          <span className="text-[10px] font-black uppercase tracking-tighter">Confirm</span>
                        )}
                      </button>

                      <button className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all">
                        Profile
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
