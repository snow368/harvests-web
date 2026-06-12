import React, { useState, useEffect, useMemo } from 'react';
import { 
  Search, 
  Instagram, 
  Sparkles, 
  Loader2, 
  CheckCircle2, 
  Heart, 
  MessageCircle, 
  UserPlus,
  UserCheck,
  Image as ImageIcon,
  ExternalLink,
  Zap,
  Clock,
  History,
  Dna,
  Send,
  Flame,
  TrendingUp,
  Target,
  Users,
  Copy,
  MessageSquare,
  Share2,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../lib/utils';
import { analyzeArtistPost, type AnalysisResult, generatePersonaDMScript } from '../lib/gemini';
import { useCRM } from '../contexts/CRMContext';
import { 
  PieChart, 
  Pie, 
  Cell, 
  ResponsiveContainer, 
  Tooltip as RechartsTooltip,
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis
} from 'recharts';
import { toast } from 'sonner';
import { CRMArtist } from '../types/crm';
import BotReviewPanels from './BotReviewPanels';
import AnalyzerBusinessPanels from './AnalyzerBusinessPanels';

const COLORS = ['#f43f5e', '#fbbf24', '#3b82f6', '#10b981'];

const HeatMeter = ({ score }: { score: number }) => {
  const isHigh = score >= 80;
  const radius = 120;
  const stroke = 20;
  const normalizedRadius = radius - stroke;
  const circumference = normalizedRadius * Math.PI;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  return (
    <div className="flex flex-col items-center justify-center relative py-10">
      <div className="relative">
        <svg height={radius} width={radius * 2} className="overflow-visible">
          {/* Background Path */}
          <path
            d={`M ${stroke},${radius} A ${normalizedRadius},${normalizedRadius} 0 0 1 ${radius * 2 - stroke},${radius}`}
            fill="none"
            stroke="#18181b"
            strokeWidth={stroke}
            strokeLinecap="round"
          />
          {/* Progress Path */}
          <motion.path
            d={`M ${stroke},${radius} A ${normalizedRadius},${normalizedRadius} 0 0 1 ${radius * 2 - stroke},${radius}`}
            fill="none"
            stroke={isHigh ? "url(#heatGradientHigh)" : "url(#heatGradientNormal)"}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ 
              strokeDashoffset,
              opacity: isHigh ? [1, 0.6, 1] : 1
            }}
            transition={{ 
              strokeDashoffset: { duration: 2, ease: "easeOut" },
              opacity: { duration: 0.8, repeat: Infinity, ease: "easeInOut" }
            }}
            className={cn(isHigh && "drop-shadow-[0_0_15px_rgba(239,68,68,0.5)]")}
          />
          <defs>
            <linearGradient id="heatGradientNormal" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#f43f5e" />
              <stop offset="100%" stopColor="#fbbf24" />
            </linearGradient>
            <linearGradient id="heatGradientHigh" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#ef4444" />
              <stop offset="100%" stopColor="#b91c1c" />
            </linearGradient>
          </defs>
        </svg>
        
        {/* Needle */}
        <motion.div 
          className="absolute bottom-0 left-1/2 w-1 h-24 bg-white origin-bottom rounded-full z-10"
          style={{ x: '-50%' }}
          initial={{ rotate: -90 }}
          animate={{ rotate: -90 + (score * 1.8) }}
          transition={{ duration: 2, ease: "easeOut" }}
        >
          <div className="w-3 h-3 bg-white rounded-full absolute -bottom-1.5 -left-1 shadow-lg" />
        </motion.div>
      </div>

      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-center">
        <motion.span 
          key={score}
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          className={cn(
            "text-6xl font-black tracking-tighter leading-none block", 
            isHigh ? "text-red-500" : "text-white"
          )}
        >
          {score}
        </motion.span>
        <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-[0.2em] mt-2">Intent Heat (Heat Meter)</p>
      </div>

      {isHigh && (
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute -top-4 px-6 py-2 bg-red-600 text-white text-xs font-black rounded-full shadow-2xl shadow-red-600/50 flex items-center gap-2 border border-red-400/30 animate-pulse"
        >
          🔥 HIGH INTENT: Suggest DM
        </motion.div>
      )}
    </div>
  );
};

const DEFAULT_RESULTS: AnalysisResult = {
  style: "Traditional / Old School",
  comment: "Absolutely stunning line work on this piece! The bold traditional style is executed perfectly here. 🔥",
  confidence: 0.94,
  styleMatch: true,
  tags: ["Traditional", "Old School", "Bold Lines"],
  interactions: {
    followedBack: true,
    repliedToComment: true,
    storiesWatched: 4,
    postsLiked: 5
  },
  styleProportions: [
    { name: "Realism", value: 15 },
    { name: "Traditional", value: 70 },
    { name: "Black & Grey", value: 15 }
  ],
  suggestedDM: "Hey! Just saw your latest traditional eagle piece - the line weight is incredible. We've got some new traditional-specific needle groupings in stock that I think you'd love. Want me to send over a sample pack?"
};

const SIMILAR_ARTISTS = [
  { handle: '@ink_master_la', reason: 'Same region, same realism style', match: 98 },
  { handle: '@black_grey_pro', reason: 'High style overlap (Black & Grey)', match: 95 },
  { handle: '@traditional_king', reason: 'Follower profile overlap', match: 92 },
  { handle: '@tattoo_vision', reason: 'Similar interaction frequency', match: 89 },
  { handle: '@needle_art_nyc', reason: 'High ticket positioning', match: 87 },
  { handle: '@grey_scale_ink', reason: 'High visual DNA match', match: 85 },
  { handle: '@realism_expert', reason: 'Local competition potential', match: 84 },
  { handle: '@ink_studio_sf', reason: 'Consistent posting rhythm', match: 82 },
  { handle: '@bold_lines_tattoo', reason: 'Complementary style (Traditional)', match: 80 },
  { handle: '@shadow_work_la', reason: 'Nearby geographic location', match: 78 },
];

export default function ArtistAnalyzer() {
  const { 
    markAsIdealTarget, 
    isScanning, 
    mockMode, 
    globalWeights, 
    interactions, 
    artists, 
    analyzeArtistVisualDNA, 
    findSimilarArtists,
    persona
  } = useCRM();
  const [handle, setHandle] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [currentArtist, setCurrentArtist] = useState<CRMArtist | null>(null);
  const [isActionTaken, setIsActionTaken] = useState(false);
  const [showSimilarModal, setShowSimilarModal] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [generatedScript, setGeneratedScript] = useState<string | null>(null);
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);

  const similarArtists = useMemo(() => {
    if (!currentArtist) return [];
    return findSimilarArtists(currentArtist.id);
  }, [currentArtist, findSimilarArtists]);

  const handleAnalyze = async () => {
    if (!handle) return;
    setIsAnalyzing(true);
    setIsActionTaken(false);
    setGeneratedScript(null);

    try {
      // Find artist in CRM or create a temporary one
      let artist = artists.find(a => a.username.toLowerCase() === handle.toLowerCase().replace('@', ''));
      
      if (!artist) {
        toast.error('Artist not found in CRM. Please import them first.');
        return;
      }

      setCurrentArtist(artist);
      
      // Call the new Visual DNA analysis
      const imageUrl = artist.profilePic || 'https://picsum.photos/seed/tattoo/800/800';
      await analyzeArtistVisualDNA(artist.id, imageUrl);
      
      toast.success('Analysis Complete');
    } catch (error) {
      console.error('Analysis failed:', error);
      toast.error('Analysis failed, please try again');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const totalScore = currentArtist?.heatScore || 0;
  const isHighIntent = currentArtist?.isHighIntent || false;
  const isElite = totalScore >= 80;

  const handleGenerateScript = async () => {
    if (!currentArtist) return;
    setIsGeneratingScript(true);
    try {
      const script = await generatePersonaDMScript(currentArtist.fullName, currentArtist.dnaTags, persona);
      setGeneratedScript(script);
      toast.success('Script Generated!', {
        description: `Tone: ${persona === 'professional' ? 'Professional' : 'Friendly'}`
      });
    } catch (error) {
      toast.error('Failed to generate script');
    } finally {
      setIsGeneratingScript(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard!');
  };

  const takeAction = () => {
    setIsActionTaken(true);
    toast.success('DM Sent!');
  };

  const handleImport = () => {
    setIsImporting(true);
    setTimeout(() => {
      setIsImporting(false);
      setShowSimilarModal(false);
      toast.success('Successfully imported 10 accounts to the execution list');
    }, 1500);
  };

  const radarData = useMemo(() => {
    if (!currentArtist?.visualDNA?.proportions) {
      return [
        { name: "Realism", value: 0 },
        { name: "Traditional", value: 0 },
        { name: "Black & Grey", value: 0 },
        { name: "Fine Line", value: 0 }
      ];
    }
    return Object.entries(currentArtist.visualDNA.proportions).map(([name, value]) => ({ name, value }));
  }, [currentArtist]);

  const artistInteractions = interactions.filter(i => i.artistId === currentArtist?.id);

  return (
    <div className="max-w-7xl mx-auto space-y-10 pb-24">
      <BotReviewPanels />
      <AnalyzerBusinessPanels />
      {/* Search & Header Section */}
      <div className={cn(
        "bg-[#111] border border-zinc-800/50 p-10 rounded-[2.5rem] relative overflow-hidden transition-all duration-500",
        isElite && "border-red-500/50 shadow-[0_0_50px_rgba(239,68,68,0.2)]"
      )}>
        <div className="absolute top-0 right-0 w-96 h-96 bg-rose-600/5 blur-[100px] -mr-48 -mt-48 rounded-full" />
        
        {isElite && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: [0.1, 0.2, 0.1] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="absolute inset-0 bg-red-600/5 pointer-events-none"
          />
        )}

        <div className="relative z-10">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-8 mb-10">
            <div className="flex items-center gap-5">
              <div className={cn(
                "w-14 h-14 rounded-2xl flex items-center justify-center border shadow-inner transition-all",
                isElite ? "bg-red-600/20 border-red-500/40" : "bg-rose-600/10 border-rose-500/20"
              )}>
                <Instagram className={cn("w-7 h-7", isElite ? "text-red-500" : "text-rose-500")} />
              </div>
              <div>
                <h3 className="text-2xl font-black tracking-tight text-white flex items-center gap-3">
                  Artist Intelligence
                  {isElite && (
                    <span className="px-3 py-1 bg-red-600 text-[10px] font-black rounded-full animate-bounce">
                      HIGH HEAT
                    </span>
                  )}
                  {mockMode && (
                    <span className="px-3 py-1 bg-blue-600 text-[10px] font-black rounded-full">
                      MOCK MODE
                    </span>
                  )}
                </h3>
                <p className="text-zinc-500 text-sm font-medium">AI-driven artist profiling and engagement automation.</p>
              </div>
            </div>

            <div className="flex gap-3">
              <button 
                onClick={() => markAsIdealTarget(currentArtist?.id || 'mock-id')}
                disabled={!currentArtist || isScanning}
                className="px-6 py-4 bg-amber-600/10 border border-amber-500/20 hover:bg-amber-600 hover:text-white text-amber-500 rounded-2xl text-sm font-black flex items-center gap-3 transition-all disabled:opacity-50"
              >
                {isScanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Target className="w-4 h-4" />}
                Ideal Target
              </button>
              <div className="relative w-full md:w-80">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
                <input 
                  type="text" 
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  placeholder="@artist_handle..."
                  className="w-full pl-12 pr-4 py-4 bg-zinc-900/80 border border-zinc-800 focus:border-rose-500 rounded-2xl outline-none transition-all text-sm font-bold placeholder:text-zinc-700"
                />
              </div>
              <button 
                onClick={handleAnalyze}
                disabled={isAnalyzing || !handle}
                className={cn(
                  "px-8 py-4 font-black rounded-2xl transition-all shadow-2xl flex items-center gap-3 whitespace-nowrap",
                  isElite 
                    ? "bg-red-600 hover:bg-red-500 shadow-red-600/30 text-white" 
                    : "bg-rose-600 hover:bg-rose-500 shadow-rose-600/30 text-white",
                  (isAnalyzing || !handle) && "bg-zinc-800 text-zinc-500 shadow-none"
                )}
              >
                {isAnalyzing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
                Analyze
              </button>

              {currentArtist && !generatedScript && (
                <button 
                  onClick={handleGenerateScript}
                  disabled={isGeneratingScript}
                  className="px-8 py-4 bg-blue-600 hover:bg-blue-500 text-white font-black rounded-2xl transition-all shadow-2xl shadow-blue-600/20 flex items-center gap-3 whitespace-nowrap"
                >
                  {isGeneratingScript ? <Loader2 className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
                  Generate AI Script
                </button>
              )}
            </div>
          </div>

          {/* Result Card (Generated Script) */}
          <AnimatePresence>
            {generatedScript && (
              <motion.div
                initial={{ opacity: 0, y: -20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -20, scale: 0.95 }}
                className="mb-10 p-8 bg-gradient-to-br from-blue-600/20 to-indigo-600/20 border border-blue-500/30 rounded-[2rem] relative overflow-hidden shadow-[0_0_40px_rgba(37,99,235,0.15)] group"
              >
                <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 blur-[80px] -mr-32 -mt-32 rounded-full" />
                
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-blue-500/20 rounded-xl flex items-center justify-center border border-blue-500/30">
                        <Sparkles className="w-5 h-5 text-blue-400" />
                      </div>
                      <h4 className="text-xl font-black text-white tracking-tight">✨ Generated Personalized Message</h4>
                    </div>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => copyToClipboard(generatedScript)}
                        className="p-3 bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-800 rounded-xl text-zinc-400 hover:text-white transition-all flex items-center gap-2 text-xs font-bold"
                      >
                        <Copy className="w-4 h-4" />
                        Copy
                      </button>
                      <button 
                        className="p-3 bg-green-600 hover:bg-green-500 text-white rounded-xl transition-all flex items-center gap-2 text-xs font-bold shadow-lg shadow-green-600/20"
                      >
                        <MessageSquare className="w-4 h-4" />
                        WhatsApp / DM
                      </button>
                    </div>
                  </div>
                  
                  <div className="p-6 bg-black/40 backdrop-blur-md border border-white/5 rounded-2xl">
                    <p className="text-lg text-blue-50 font-medium leading-relaxed italic">
                      "{generatedScript}"
                    </p>
                  </div>
                  
                  <div className="mt-6 flex items-center gap-4 text-[10px] font-black text-blue-400/60 uppercase tracking-[0.2em]">
                    <span className="flex items-center gap-1.5">
                      <CheckCircle2 className="w-3 h-3" />
                      Persona: {currentArtist?.styleMatch ? 'Professional' : 'Friendly'}
                    </span>
                    <span className="w-1 h-1 bg-blue-400/30 rounded-full" />
                    <span>Optimized for High Conversion</span>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Heat Meter Dashboard (Always Visible) */}
          <div className={cn(
            "bg-zinc-900/30 border border-zinc-800/50 rounded-[2rem] p-8 flex flex-col items-center justify-center relative transition-all",
            isElite && "border-red-500/30 bg-red-950/5"
          )}>
            <HeatMeter score={totalScore} />
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-12 w-full max-w-4xl mt-4 border-t border-zinc-800/50 pt-10">
              <div className="text-center group">
                <p className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.2em] mb-2 group-hover:text-zinc-400 transition-colors">Analysis Confidence</p>
                <p className="text-2xl font-black text-white">{currentArtist?.visualDNA ? Math.round(currentArtist.visualDNA.match_score) : '--'}%</p>
              </div>
              <div className="text-center group">
                <p className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.2em] mb-2 group-hover:text-zinc-400 transition-colors">Style Match</p>
                <p className={cn("text-2xl font-black", currentArtist?.styleMatch ? "text-green-500" : "text-rose-500")}>
                  {currentArtist?.styleMatch ? 'Match' : 'No Match'}
                </p>
              </div>
              <div className="text-center group">
                <p className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.2em] mb-2 group-hover:text-zinc-400 transition-colors">Interaction Score</p>
                <p className={cn("text-2xl font-black", isElite ? "text-red-500" : "text-white")}>{totalScore}</p>
              </div>
              <div className="text-center group">
                <p className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.2em] mb-2 group-hover:text-zinc-400 transition-colors">Conversion Potential</p>
                <p className={cn("text-2xl font-black", isElite ? "text-red-500" : "text-amber-500")}>
                  {isElite ? 'Elite' : 'Good'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {currentArtist && (
          <motion.div 
            key={currentArtist.id}
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="grid grid-cols-1 lg:grid-cols-2 gap-10 mt-12"
          >
            {/* Left Card: Visual DNA & Interaction */}
            <div className="bg-[#111] border border-zinc-800/50 p-8 rounded-[2rem] flex flex-col shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 left-0 w-48 h-48 bg-blue-600/5 blur-[60px] -ml-24 -mt-24 rounded-full" />
              
              <div className="flex items-center justify-between mb-8 relative z-10">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-blue-500/10 rounded-2xl flex items-center justify-center border border-blue-500/20">
                    <Dna className="w-6 h-6 text-blue-500" />
                  </div>
                  <h4 className="text-lg font-black tracking-tight">Visual DNA Analysis</h4>
                </div>
                <TrendingUp className="w-5 h-5 text-zinc-700" />
              </div>

              <div className="space-y-8 flex-1 relative z-10">
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart cx="50%" cy="50%" outerRadius="80%" data={radarData}>
                      <PolarGrid stroke="#333" />
                      <PolarAngleAxis dataKey="name" tick={{ fill: '#666', fontSize: 10 }} />
                      <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                      <Radar
                        name="Visual DNA"
                        dataKey="value"
                        stroke="#f43f5e"
                        fill="#f43f5e"
                        fillOpacity={0.6}
                      />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {radarData.map((style, idx) => (
                    <div key={style.name} className="flex flex-col items-center p-3 bg-zinc-900/50 border border-zinc-800 rounded-2xl">
                      <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">{style.name}</span>
                      <span className="text-sm font-black text-white">{style.value}%</span>
                      <div className="w-full h-1 mt-2 bg-zinc-800 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${style.value}%`, backgroundColor: COLORS[idx % COLORS.length] }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-10 pt-10 border-t border-zinc-800/50">
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-12 h-12 bg-amber-500/10 rounded-2xl flex items-center justify-center border border-amber-500/20">
                    <History className="w-6 h-6 text-amber-500" />
                  </div>
                  <h4 className="text-lg font-black tracking-tight">Social Interaction Timeline</h4>
                </div>
                
                <div className="space-y-6">
                  {artistInteractions.length > 0 ? (
                    artistInteractions.map((interaction, idx) => (
                      <div key={interaction.id} className="relative pl-12 group">
                        {idx < artistInteractions.length - 1 && (
                          <div className="absolute left-6 top-12 bottom-0 w-px bg-zinc-800 group-hover:bg-rose-500/30 transition-colors" />
                        )}
                        <div className="absolute left-0 top-0 w-12 h-12 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center z-10 group-hover:border-rose-500/50 transition-all shadow-lg">
                          {interaction.type === 'like' && <Heart className="w-5 h-5 text-rose-500" />}
                          {interaction.type === 'comment' && <MessageCircle className="w-5 h-5 text-blue-500" />}
                          {interaction.type === 'follow' && <UserCheck className="w-5 h-5 text-green-500" />}
                          {interaction.type === 'story_view' && <ImageIcon className="w-5 h-5 text-amber-500" />}
                          {interaction.type === 'dm_reply' && <MessageSquare className="w-5 h-5 text-purple-500" />}
                        </div>
                        <div className="flex flex-col">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-black text-white capitalize">{interaction.type.replace('_', ' ')}</span>
                            <span className="text-xs font-black text-green-500 bg-green-500/10 px-2 py-0.5 rounded-lg">+{interaction.weight}</span>
                          </div>
                          <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">
                            {new Date(interaction.timestamp).toLocaleString()}
                          </span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <>
                      {currentArtist.hasFollowedBack && (
                        <div className="relative pl-12 group">
                          <div className="absolute left-6 top-12 bottom-0 w-px bg-zinc-800 group-hover:bg-rose-500/30 transition-colors" />
                          <div className="absolute left-0 top-0 w-12 h-12 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center z-10 border-green-500/50 shadow-lg">
                            <UserCheck className="w-5 h-5 text-green-500" />
                          </div>
                          <div className="flex flex-col">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm font-black text-white">Followed back</span>
                              <span className="text-xs font-black text-green-500 bg-green-500/10 px-2 py-0.5 rounded-lg">+40</span>
                            </div>
                            <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">Achieved</span>
                          </div>
                        </div>
                      )}
                      {currentArtist.replyCount > 0 && (
                        <div className="relative pl-12 group">
                          <div className="absolute left-6 top-12 bottom-0 w-px bg-zinc-800 group-hover:bg-rose-500/30 transition-colors" />
                          <div className="absolute left-0 top-0 w-12 h-12 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center z-10 border-green-500/50 shadow-lg">
                            <MessageCircle className="w-5 h-5 text-green-500" />
                          </div>
                          <div className="flex flex-col">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm font-black text-white">Replied to Comment</span>
                              <span className="text-xs font-black text-green-500 bg-green-500/10 px-2 py-0.5 rounded-lg">+{currentArtist.replyCount * 20}</span>
                            </div>
                            <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">Achieved</span>
                          </div>
                        </div>
                      )}
                      {currentArtist.storyViews24h > 0 && (
                        <div className="relative pl-12 group">
                          <div className="absolute left-6 top-12 bottom-0 w-px bg-zinc-800 group-hover:bg-rose-500/30 transition-colors" />
                          <div className="absolute left-0 top-0 w-12 h-12 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center z-10 border-amber-500/50 shadow-lg">
                            <ImageIcon className="w-5 h-5 text-amber-500" />
                          </div>
                          <div className="flex flex-col">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm font-black text-white">Viewed Story ({currentArtist.storyViews24h}x)</span>
                              <span className="text-xs font-black text-green-500 bg-green-500/10 px-2 py-0.5 rounded-lg">+{currentArtist.storyViews24h * 1}</span>
                            </div>
                            <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">Active Interaction</span>
                          </div>
                        </div>
                      )}
                      {currentArtist.likeCount > 0 && (
                        <div className="relative pl-12 group">
                          <div className="absolute left-0 top-0 w-12 h-12 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center z-10 border-rose-500/50 shadow-lg">
                            <Heart className="w-5 h-5 text-rose-500" />
                          </div>
                          <div className="flex flex-col">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm font-black text-white">Liked Posts ({currentArtist.likeCount} times)</span>
                              <span className="text-xs font-black text-green-500 bg-green-500/10 px-2 py-0.5 rounded-lg">+{currentArtist.likeCount * 5}</span>
                            </div>
                            <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">Active Interaction</span>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
                
                <div className="mt-auto pt-10">
                  <div className="p-6 bg-zinc-900/80 border border-zinc-800 rounded-3xl shadow-inner">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">Total Interaction Score</span>
                      <span className="text-lg font-black text-white">
                        {totalScore} / 100
                      </span>
                    </div>
                    <div className="h-3 bg-zinc-800 rounded-full overflow-hidden p-0.5">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${totalScore}%` }}
                        transition={{ duration: 1.5, ease: "easeOut" }}
                        className="h-full bg-gradient-to-r from-amber-600 to-amber-400 rounded-full shadow-[0_0_10px_rgba(245,158,11,0.3)]" 
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Card: Smart Action Suggestions */}
            <div className="bg-[#111] border border-zinc-800/50 p-8 rounded-[2rem] flex flex-col shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 w-48 h-48 bg-rose-600/5 blur-[60px] -mr-24 -mt-24 rounded-full" />
              
              <div className="flex items-center justify-between mb-8 relative z-10">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-rose-500/10 rounded-2xl flex items-center justify-center border border-rose-500/20">
                    <Zap className="w-6 h-6 text-rose-500" />
                  </div>
                  <h4 className="text-lg font-black tracking-tight">Smart Action Suggestions</h4>
                </div>
              </div>
              
              <div className="space-y-8 flex-1 relative z-10">
                <div className="p-6 bg-zinc-900/50 border border-zinc-800 rounded-3xl relative group hover:border-rose-500/30 transition-all">
                  <p className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.2em] mb-4">Recommended AI Script</p>
                  <p className="text-sm text-zinc-300 leading-relaxed font-medium italic">
                    {generatedScript || (currentArtist?.style ? `Hey! I love your ${currentArtist.style} style. We have some new supplies that would fit your work perfectly.` : "Select an artist to generate a personalized script.")}
                  </p>
                  <button className="absolute top-6 right-6 text-zinc-700 hover:text-white transition-colors">
                    <ExternalLink className="w-5 h-5" />
                  </button>
                </div>

                <div className="space-y-5">
                  <p className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.2em]">Strategy</p>
                  <div className="flex items-center gap-4 p-4 bg-green-500/5 border border-green-500/10 rounded-2xl">
                    <div className="w-8 h-8 rounded-xl bg-green-500/10 flex items-center justify-center">
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                    </div>
                    <span className="text-xs font-bold text-zinc-400">
                      {totalScore >= 80 ? 'Heat is extremely high, conversion rate expected to increase by 45%' : 'Heat is rising steadily, suggest maintaining interaction'}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 p-4 bg-blue-500/5 border border-blue-500/10 rounded-2xl">
                    <div className="w-8 h-8 rounded-xl bg-blue-500/10 flex items-center justify-center">
                      <MessageCircle className="w-4 h-4 text-blue-500" />
                    </div>
                    <span className="text-xs font-bold text-zinc-400">Suggest sending within 15 minutes after they post a new Story</span>
                  </div>
                </div>
              </div>

              <div className="mt-10 relative z-10">
                <button 
                  onClick={takeAction}
                  disabled={isActionTaken || !isElite}
                  className={cn(
                    "w-full py-5 rounded-2xl font-black text-sm flex items-center justify-center gap-3 transition-all shadow-2xl",
                    isActionTaken 
                      ? "bg-green-500/10 text-green-500 border border-green-500/20" 
                      : !isElite
                        ? "bg-zinc-800 text-zinc-500 border border-zinc-700 cursor-not-allowed"
                        : "bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/40 hover:scale-[1.02] active:scale-95"
                  )}
                >
                  {isActionTaken ? (
                    <>
                      <CheckCircle2 className="w-6 h-6" />
                      DM Sent
                    </>
                  ) : !isElite ? (
                    <>
                      <Clock className="w-6 h-6" />
                      Insufficient Heat (Score {totalScore}/80)
                    </>
                  ) : (
                    <>
                      ⚡ Send AI Message
                    </>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {currentArtist && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex justify-center pt-10"
        >
          <button
            onClick={() => setShowSimilarModal(true)}
            className="group flex items-center gap-3 px-10 py-5 bg-zinc-900 border border-zinc-800 hover:border-blue-500/50 rounded-2xl transition-all shadow-xl hover:shadow-blue-500/10"
          >
            <Users className="w-6 h-6 text-blue-500 group-hover:scale-110 transition-transform" />
            <span className="text-sm font-black text-white">Find Similar Artists Based on This Profile</span>
          </button>
        </motion.div>
      )}

      {/* Similar Artists Modal */}
      <AnimatePresence>
        {showSimilarModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-8">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSimilarModal(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-4xl bg-[#111] border border-zinc-800 rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              {/* Modal Header */}
              <div className="p-8 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/50">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-blue-500/10 rounded-2xl flex items-center justify-center border border-blue-500/20">
                    <Users className="w-6 h-6 text-blue-500" />
                  </div>
                  <div>
                    <h3 className="text-xl font-black text-white">Similar Artist Recommendations</h3>
                    <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mt-1">Based on Visual DNA & Engagement Patterns</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-4">
                  <button
                    onClick={handleImport}
                    disabled={isImporting}
                    className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 text-white text-xs font-black rounded-xl transition-all shadow-lg shadow-blue-600/20"
                  >
                    {isImporting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                    One-Click Import to Execution List
                  </button>
                  <button 
                    onClick={() => setShowSimilarModal(false)}
                    className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-700 transition-all"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Modal Content - Table */}
              <div className="flex-1 overflow-y-auto p-8">
                <table className="w-full text-left border-separate border-spacing-y-3">
                  <thead>
                    <tr className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.2em]">
                      <th className="px-6 pb-4">Handle</th>
                      <th className="px-6 pb-4 text-center">Match</th>
                      <th className="px-6 pb-4">Matching Reason</th>
                      <th className="px-6 pb-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {similarArtists.map((match, idx) => (
                      <motion.tr 
                        key={idx}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.05 }}
                        className="group bg-zinc-900/50 hover:bg-zinc-900 border border-zinc-800 rounded-2xl transition-all"
                      >
                        <td className="px-6 py-5 rounded-l-2xl border-y border-l border-zinc-800 group-hover:border-blue-500/30">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center overflow-hidden">
                              <img 
                                src={match.artist.profilePic || `https://picsum.photos/seed/${match.artist.username}/100/100`} 
                                alt="" 
                                className="w-full h-full object-cover opacity-80"
                                referrerPolicy="no-referrer"
                              />
                            </div>
                            <span className="text-sm font-black text-white">@{match.artist.username}</span>
                          </div>
                        </td>
                        <td className="px-6 py-5 border-y border-zinc-800 group-hover:border-blue-500/30 text-center">
                          <div className="inline-flex items-center justify-center px-3 py-1 bg-blue-500/10 rounded-full border border-blue-500/20">
                            <span className="text-xs font-black text-blue-500">{match.artist.heatScore}%</span>
                          </div>
                        </td>
                        <td className="px-6 py-5 border-y border-zinc-800 group-hover:border-blue-500/30">
                          <span className="text-xs font-bold text-zinc-400">{match.reason}</span>
                        </td>
                        <td className="px-6 py-5 rounded-r-2xl border-y border-r border-zinc-800 group-hover:border-blue-500/30 text-right">
                          <button className="p-2 text-zinc-600 hover:text-blue-500 transition-colors">
                            <ExternalLink className="w-4 h-4" />
                          </button>
                        </td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Modal Footer */}
              <div className="p-8 border-t border-zinc-800 bg-zinc-900/30 text-center">
                <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">
                  AI engine has completed similarity calculation based on 128 feature dimensions of the current artist
                </p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Original Post Preview */}
      {currentArtist && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="bg-[#111] border border-zinc-800/50 p-10 rounded-[2.5rem] shadow-2xl"
        >
          <div className="flex flex-col lg:flex-row gap-12">
            <div className="w-full lg:w-80 aspect-square rounded-[2rem] overflow-hidden bg-zinc-900 border border-zinc-800 shadow-2xl relative group">
              <img 
                src={currentArtist.profilePic || "https://picsum.photos/seed/tattoo/800/800"} 
                alt="Tattoo Post" 
                className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <div className="flex-1 space-y-8 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-rose-600/20 flex items-center justify-center text-rose-500 font-black text-xl border border-rose-500/20">
                    {currentArtist.username[0]?.toUpperCase() || 'A'}
                  </div>
                  <div>
                    <p className="text-xl font-black text-white">@{currentArtist.username}</p>
                    <p className="text-xs font-bold text-zinc-600 uppercase tracking-widest">Featured Artist</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-xl flex items-center gap-2">
                    <Heart className="w-4 h-4 text-rose-500" />
                    <span className="text-xs font-black">{currentArtist.likeCount || 0}</span>
                  </div>
                  <div className="px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-xl flex items-center gap-2">
                    <MessageCircle className="w-4 h-4 text-blue-500" />
                    <span className="text-xs font-black">{currentArtist.replyCount || 0}</span>
                  </div>
                </div>
              </div>
              
              <div className="p-6 bg-zinc-900/30 border-l-4 border-rose-600 rounded-2xl italic">
                <p className="text-zinc-400 leading-relaxed font-medium">
                  "{currentArtist.visualDNA?.technical_details.join(', ') || 'Analyzing style and technical details...'}"
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                {currentArtist.dnaTags.map(tag => (
                  <span key={tag} className="px-3 py-1 bg-zinc-900 text-zinc-500 text-[10px] font-bold rounded-lg border border-zinc-800">
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
