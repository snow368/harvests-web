import React, { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  Upload,
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Trash2,
  MessageSquare,
  Zap,
  Brain,
  Lightbulb,
  RefreshCw,
  PlusCircle,
  ShieldCheck,
  Target,
  Info,
  Send,
  Type as TypeIcon,
  Terminal,
  UserCircle,
  Users,
  Handshake,
  DollarSign,
  HeartHandshake,
  Gauge,
  Sparkles as SparklesIcon,
  MessageCircle,
  Instagram,
  X,
  Save,
  ChevronRight,
  Bot
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../lib/utils';
import { identifyKnowledgeGaps, getTrainingStatus, generateChatResponse, safeJsonParse, type TrainingStatus } from '../lib/gemini';
import { toast } from 'sonner';
import { useCRM } from '../contexts/CRMContext';
import { AIPersona } from '../types/crm';

type Scenario = 'ice-breaking' | 'pricing' | 'after-sales';
type Persona = 'professional' | 'friendly';

// Map ChatTrainer scenarios to marketing_scripts categories
const SCENARIO_CATEGORY_MAP: Record<Scenario, string> = {
  'ice-breaking': 'industry_talk',
  'pricing': 'product_intro',
  'after-sales': 'after_sales'
};

// Direction options per scenario
const SCENARIO_DIRECTIONS: Record<Scenario, { value: string; label: string }[]> = {
  'ice-breaking': [
    { value: 'tech_discussion', label: '技术交流 — 聊纹身技术/风格引发共鸣' },
    { value: 'compliment_approach', label: '夸奖切入 — 赞美作品后自然接话' },
    { value: 'industry_share', label: '行业分享 — 分享行业资讯破冰' },
  ],
  'pricing': [
    { value: 'website_visit', label: '引导网站 — 引导查看产品目录和价格' },
    { value: 'sample_review', label: '样品体验 — 推新品体验/样品' },
    { value: 'bulk_discount', label: '批量优惠 — 批量采购优惠方案' },
  ],
  'after-sales': [
    { value: 'satisfaction_check', label: '满意度回访 — 使用体验如何' },
    { value: 'cross_sell', label: '互补推荐 — 推荐搭配产品' },
    { value: 'vip_reward', label: 'VIP激励 — 专属优惠/复购激励' },
  ]
};

export default function ChatTrainer() {
  const { persona, setPersona, artists } = useCRM();
  const [files, setFiles] = useState<File[]>([]);
  const [pastedText, setPastedText] = useState('');
  const [isTraining, setIsTraining] = useState(false);
  const [trainingProgress, setTrainingProgress] = useState(0);
  const [isComplete, setIsComplete] = useState(false);
  const [knowledgeGaps, setKnowledgeGaps] = useState<string[]>([]);
  const [isRefreshingGaps, setIsRefreshingGaps] = useState(false);
  const [trainingStatus, setTrainingStatus] = useState<TrainingStatus | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [importMode, setImportMode] = useState<'browser' | 'python'>('browser');
  const [competitorHandlesText, setCompetitorHandlesText] = useState('');
  const [competitors, setCompetitors] = useState<any[]>([]);
  const [contentSamples, setContentSamples] = useState<any[]>([]);
  const [contentTemplates, setContentTemplates] = useState<any[]>([]);
  const [contentLoading, setContentLoading] = useState(false);
  const [llmTasks, setLlmTasks] = useState<any[]>([]);
  const [llmLoading, setLlmLoading] = useState(false);

  // Script Library
  const [scriptLibrary, setScriptLibrary] = useState<any[]>([]);
  const [scriptLibLoading, setScriptLibLoading] = useState(false);
  const [scriptDeleteId, setScriptDeleteId] = useState<number | null>(null);

  // DM History
  const [dmHistory, setDmHistory] = useState<any[]>([]);
  const [dmHistoryLoading, setDmHistoryLoading] = useState(false);
  const [dmStats, setDmStats] = useState<Record<string, number>>({});
  const [dmConversionRate, setDmConversionRate] = useState(0);
  const [selectedConversation, setSelectedConversation] = useState<any | null>(null);

  // New State
  const [activeScenario, setActiveScenario] = useState<Scenario>('ice-breaking');
  
  // Calculate maturity based on training status and customer count
  const maturity = React.useMemo(() => {
    const base = trainingStatus?.readinessScore || 0;
    const customerBonus = Math.min(20, artists.filter(a => a.stage === 'customers').length);
    return Math.min(100, base + customerBonus);
  }, [trainingStatus, artists]);

  const [scenarioData, setScenarioData] = useState<Record<Scenario, string>>({
    'ice-breaking': '',
    'pricing': '',
    'after-sales': ''
  });
  const [scenarioDirection, setScenarioDirection] = useState<Record<Scenario, string>>({
    'ice-breaking': 'tech_discussion',
    'pricing': 'website_visit',
    'after-sales': 'satisfaction_check'
  });
  const [scenarioSaving, setScenarioSaving] = useState(false);

  // Load existing scripts from backend on mount
  useEffect(() => {
    const loadScripts = async () => {
      try {
        for (const scenario of ['ice-breaking', 'pricing', 'after-sales'] as Scenario[]) {
          const category = SCENARIO_CATEGORY_MAP[scenario];
          const res = await fetch(`/api/marketing/scripts?category=${category}`);
          if (!res.ok) continue;
          const data = await res.json();
          const scripts = data?.scripts || [];
          if (scripts.length > 0) {
            // Load the best script content
            setScenarioData(prev => ({ ...prev, [scenario]: scripts[0].content }));
            if (scripts[0].direction) {
              setScenarioDirection(prev => ({ ...prev, [scenario]: scripts[0].direction }));
            }
          }
        }
      } catch {}
    };
    loadScripts();
  }, []);

  // Test AI State
  const [testMessages, setTestMessages] = useState<{ role: 'user' | 'ai', content: string }[]>([
    { role: 'ai', content: 'Hello! I am your AI assistant. I am ready to answer your questions based on the training results.' }
  ]);
  const [testQuery, setTestQuery] = useState('');
  const [isTesting, setIsTesting] = useState(false);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    setFiles(prev => [...prev, ...acceptedFiles]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/plain': ['.txt'],
      'application/json': ['.json'],
      'text/csv': ['.csv']
    },
    multiple: true
  } as any);

  const refreshGaps = async () => {
    setIsRefreshingGaps(true);
    try {
      const summary = (files.length > 0 || pastedText)
        ? `The AI has seen ${files.length} files and ${pastedText.length} characters of pasted text.`
        : "The AI has no training data yet.";
      
      const [gaps, status] = await Promise.all([
        identifyKnowledgeGaps(summary),
        getTrainingStatus(summary)
      ]);
      
      setKnowledgeGaps(gaps);
      setTrainingStatus(status);
    } catch (error) {
      console.error("Failed to refresh gaps:", error);
    } finally {
      setIsRefreshingGaps(false);
    }
  };

  useEffect(() => {
    refreshGaps();
  }, []);

  const loadLlmTasks = useCallback(async () => {
    try {
      setLlmLoading(true);
      const res = await fetch('/api/llm/tasks?limit=50');
      if (!res.ok) return;
      const payload = await res.json();
      setLlmTasks(Array.isArray(payload?.rows) ? payload.rows : []);
    } finally {
      setLlmLoading(false);
    }
  }, []);

  const loadContentIntel = useCallback(async () => {
    try {
      setContentLoading(true);
      const [cRes, sRes, tRes] = await Promise.all([
        fetch('/api/content/competitors'),
        fetch('/api/content/samples?limit=20'),
        fetch('/api/content/templates')
      ]);
      if (cRes.ok) {
        const c = await cRes.json();
        setCompetitors(Array.isArray(c?.rows) ? c.rows : []);
      }
      if (sRes.ok) {
        const s = await sRes.json();
        setContentSamples(Array.isArray(s?.rows) ? s.rows : []);
      }
      if (tRes.ok) {
        const t = await tRes.json();
        setContentTemplates(Array.isArray(t?.rows) ? t.rows : []);
      }
    } finally {
      setContentLoading(false);
    }
  }, []);

  const importCompetitorHandles = useCallback(async () => {
    const handles = competitorHandlesText
      .split(/\r?\n|,|\s+/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (!handles.length) {
      toast.error('Please input at least one competitor handle');
      return;
    }
    const res = await fetch('/api/content/competitors/import-handles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handles, source: 'manual_training' })
    });
    if (!res.ok) {
      toast.error('Import competitors failed');
      return;
    }
    const payload = await res.json();
    toast.success(`Imported ${Number(payload?.imported || 0)} competitors`);
    await loadContentIntel();
  }, [competitorHandlesText, loadContentIntel]);

  const ingestSamples = useCallback(async () => {
    const res = await fetch('/api/content/samples/ingest-from-observations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 800 })
    });
    if (!res.ok) {
      toast.error('Ingest samples failed');
      return;
    }
    const payload = await res.json();
    toast.success(`Ingested ${Number(payload?.inserted || 0)} samples`);
    await loadContentIntel();
  }, [loadContentIntel]);

  const generateTemplates = useCallback(async () => {
    const res = await fetch('/api/content/templates/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ horizonDays: 7 })
    });
    if (!res.ok) {
      toast.error('Generate templates failed');
      return;
    }
    toast.success('Generated 7-day template plan');
    await loadContentIntel();
  }, [loadContentIntel]);

  useEffect(() => {
    void loadContentIntel();
  }, [loadContentIntel]);

  useEffect(() => {
    void loadLlmTasks();
    const t = setInterval(() => {
      void loadLlmTasks();
    }, 12000);
    return () => clearInterval(t);
  }, [loadLlmTasks]);

  // Script Library & DM History
  const loadScriptLibrary = useCallback(async () => {
    setScriptLibLoading(true);
    try {
      const res = await fetch('/api/marketing/scripts?active=false');
      if (res.ok) {
        const data = await res.json();
        setScriptLibrary(Array.isArray(data?.scripts) ? data.scripts : []);
      }
    } finally {
      setScriptLibLoading(false);
    }
  }, []);

  const loadDmHistory = useCallback(async () => {
    setDmHistoryLoading(true);
    try {
      const [histRes, statsRes] = await Promise.all([
        fetch('/api/marketing/tasks/history?limit=20'),
        fetch('/api/marketing/tasks/stats')
      ]);
      if (histRes.ok) {
        const d = await histRes.json();
        setDmHistory(Array.isArray(d?.tasks) ? d.tasks : []);
      }
      if (statsRes.ok) {
        const s = await statsRes.json();
        setDmStats(s?.counts || {});
        setDmConversionRate(s?.conversionRate || 0);
      }
    } finally {
      setDmHistoryLoading(false);
    }
  }, []);

  useEffect(() => { void loadScriptLibrary(); }, [loadScriptLibrary]);
  useEffect(() => { void loadDmHistory(); }, [loadDmHistory]);

  const handleSaveScript = async () => {
    const content = scenarioData[activeScenario]?.trim();
    if (!content) return;
    setScenarioSaving(true);
    try {
      const category = SCENARIO_CATEGORY_MAP[activeScenario];
      const direction = scenarioDirection[activeScenario];
      const label = activeScenario === 'ice-breaking' ? 'Ice-breaking' : activeScenario === 'pricing' ? 'Pricing' : 'After-sales';
      const res = await fetch('/api/marketing/scripts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          direction,
          title: `${label} - ${direction}`,
          content,
          tone: 'professional_friendly',
          tags: `${category},${direction},${label.toLowerCase().replace(/\s+/g, '_')}`,
          match_conditions: { scenario: activeScenario }
        })
      });
      if (!res.ok) throw new Error('Save failed');
      toast.success(`Script saved`, { description: `${label} → ${direction} 已保存到话术库` });
      await loadScriptLibrary();
    } catch (err) {
      toast.error('Save failed', { description: 'Could not save script to library' });
    } finally {
      setScenarioSaving(false);
    }
  };

  const handleDeleteScript = async (id: number) => {
    setScriptDeleteId(id);
    try {
      const res = await fetch(`/api/marketing/scripts/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      toast.success('Script deleted');
      await loadScriptLibrary();
    } catch {
      toast.error('Delete failed');
    } finally {
      setScriptDeleteId(null);
    }
  };

  const handleEditScript = (script: any) => {
    // Find which scenario this script belongs to
    for (const [scenario, category] of Object.entries(SCENARIO_CATEGORY_MAP)) {
      if (script.category === category) {
        setActiveScenario(scenario as Scenario);
        setScenarioData(prev => ({ ...prev, [scenario]: script.content }));
        setScenarioDirection(prev => ({ ...prev, [scenario]: script.direction || prev[scenario as Scenario] }));
        toast.success(`Loaded "${script.title}" into editor`);
        return;
      }
    }
    toast.error('Could not match script category to a scenario');
  };

  const handleTrain = async () => {
    if (files.length === 0 && !pastedText) return;
    
    setIsTraining(true);
    setIsComplete(false);
    setTrainingProgress(0);

    // Read file contents if any
    let allContent = pastedText;
    for (const file of files) {
      try {
        const text = await file.text();
        if (file.name.endsWith('.json')) {
          // Basic attempt to extract text from Instagram JSON
          try {
            if (!text || text.trim() === 'undefined') {
              throw new Error("Invalid JSON content");
            }
            const data = safeJsonParse(text, null);
            if (data && data.messages) {
              const extracted = data.messages
                .map((m: any) => `${m.sender_name}: ${m.content || ''}`)
                .join('\n');
              allContent += `\n---\n${extracted}`;
            }
          } catch (e) {
            allContent += `\n---\n${text}`;
          }
        } else {
          allContent += `\n---\n${text}`;
        }
      } catch (err) {
        console.error("Failed to read file:", file.name);
      }
    }

    // Simulate training progress
    for (let i = 0; i <= 100; i += 10) {
      setTrainingProgress(i);
      await new Promise(r => setTimeout(r, 400));
    }

    // In a real app, we'd send allContent to the backend/AI here
    // For now, we'll refresh the gaps based on the total content
    setIsTraining(false);
    setIsComplete(true);
    
    // Pass the actual content summary to refreshGaps
    const summary = `The AI has processed ${allContent.length} characters of data across ${files.length} files and manual paste.`;
    const [gaps, status] = await Promise.all([
      identifyKnowledgeGaps(summary),
      getTrainingStatus(summary)
    ]);
    
    setKnowledgeGaps(gaps);
    setTrainingStatus(status);
    toast.success("Training complete! AI knowledge updated.");
  };

  const handleTest = async () => {
    if (!testQuery) return;
    
    const newUserMessage = { role: 'user' as const, content: testQuery };
    setTestMessages(prev => [...prev, newUserMessage]);
    setTestQuery('');
    setIsTesting(true);

    try {
      const history = pastedText || "Sample history: Customer asked about shipping. Clerk replied $8.99.";
      // Use the new persona-based script generation for testing if needed, 
      // but generateChatResponse is more for general chat.
      // Let's stick to generateChatResponse but maybe pass persona context if we update it later.
      const response = await generateChatResponse(history, testQuery);
      setTestMessages(prev => [...prev, { role: 'ai' as const, content: response }]);
    } catch (error) {
      console.error("Test failed:", error);
      setTestMessages(prev => [...prev, { role: 'ai' as const, content: "Sorry, I cannot answer this question at the moment. Please check the training data." }]);
    } finally {
      setIsTesting(false);
    }
  };

  const removeFile = (index: number) => {
    setFiles(files.filter((_, i) => i !== index));
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-24">
      {/* Top Header: AI Maturity & Persona */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* AI Maturity Card */}
        <div className="lg:col-span-2 bg-[#111] border border-zinc-800/50 p-8 rounded-[2.5rem] relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-rose-600/5 blur-[80px] -mr-32 -mt-32 rounded-full" />
          
          <div className="relative z-10 flex flex-col md:flex-row items-center gap-10">
            <div className="relative w-48 h-48 flex items-center justify-center">
              <svg className="w-full h-full -rotate-90">
                <circle
                  cx="96"
                  cy="96"
                  r="88"
                  fill="transparent"
                  stroke="currentColor"
                  strokeWidth="12"
                  className="text-zinc-800"
                />
                <motion.circle
                  cx="96"
                  cy="96"
                  r="88"
                  fill="transparent"
                  stroke="currentColor"
                  strokeWidth="12"
                  strokeDasharray={552.92}
                  initial={{ strokeDashoffset: 552.92 }}
                  animate={{ strokeDashoffset: 552.92 - (552.92 * maturity) / 100 }}
                  transition={{ duration: 2, ease: "easeOut" }}
                  className="text-rose-600"
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-4xl font-black text-white">{maturity}%</span>
                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">AI Maturity</span>
              </div>
            </div>

            <div className="flex-1 space-y-4 text-center md:text-left">
              <div className="flex items-center justify-center md:justify-start gap-3">
                <div className="w-10 h-10 bg-rose-600/10 rounded-xl flex items-center justify-center border border-rose-500/20">
                  <Gauge className="w-5 h-5 text-rose-500" />
                </div>
                <h3 className="text-2xl font-black tracking-tight">AI Training Status Assessment</h3>
              </div>
              <p className="text-sm text-zinc-400 leading-relaxed max-w-md">
                The current AI has basic business logic understanding. It is recommended to continue adding real conversation records for the "Pricing" scenario to improve conversion rates.
              </p>
              <div className="flex flex-wrap gap-2 justify-center md:justify-start">
                <span className="px-3 py-1 bg-green-500/10 text-green-500 text-[10px] font-black rounded-full border border-green-500/20 uppercase tracking-wider">Logic Closed-loop</span>
                <span className="px-3 py-1 bg-blue-500/10 text-blue-500 text-[10px] font-black rounded-full border border-blue-500/20 uppercase tracking-wider">Consistent Style</span>
                <span className="px-3 py-1 bg-amber-500/10 text-amber-500 text-[10px] font-black rounded-full border border-amber-500/20 uppercase tracking-wider">To be optimized: Pricing</span>
              </div>
            </div>
          </div>
        </div>

        {/* Persona Switch Card */}
        <div className="bg-[#111] border border-zinc-800/50 p-8 rounded-[2.5rem] flex flex-col justify-between relative overflow-hidden">
          <div className="relative z-10">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 bg-amber-500/10 rounded-2xl flex items-center justify-center border border-amber-500/20">
                <UserCircle className="w-6 h-6 text-amber-500" />
              </div>
              <h4 className="text-lg font-black tracking-tight">AI Persona Switch</h4>
            </div>

            <div className="space-y-3">
              <button 
                onClick={() => setPersona('professional')}
                className={cn(
                  "w-full p-4 rounded-2xl border transition-all flex items-center gap-4 group",
                  persona === 'professional' 
                    ? "bg-rose-600 border-rose-500 shadow-lg shadow-rose-600/20" 
                    : "bg-zinc-900 border-zinc-800 hover:border-zinc-700"
                )}
              >
                <div className={cn(
                  "w-10 h-10 rounded-xl flex items-center justify-center transition-colors",
                  persona === 'professional' ? "bg-white/20" : "bg-zinc-800 group-hover:bg-zinc-700"
                )}>
                  <ShieldCheck className={cn("w-5 h-5", persona === 'professional' ? "text-white" : "text-zinc-500")} />
                </div>
                <div className="text-left">
                  <p className={cn("text-sm font-black", persona === 'professional' ? "text-white" : "text-zinc-300")}>Professional Consultant</p>
                  <p className={cn("text-[10px] font-medium", persona === 'professional' ? "text-rose-100" : "text-zinc-500")}>Rigorous, professional, trustworthy</p>
                </div>
              </button>

              <button 
                onClick={() => setPersona('friendly')}
                className={cn(
                  "w-full p-4 rounded-2xl border transition-all flex items-center gap-4 group",
                  persona === 'friendly' 
                    ? "bg-rose-600 border-rose-500 shadow-lg shadow-rose-600/20" 
                    : "bg-zinc-900 border-zinc-800 hover:border-zinc-700"
                )}
              >
                <div className={cn(
                  "w-10 h-10 rounded-xl flex items-center justify-center transition-colors",
                  persona === 'friendly' ? "bg-white/20" : "bg-zinc-800 group-hover:bg-zinc-700"
                )}>
                  <Handshake className={cn("w-5 h-5", persona === 'friendly' ? "text-white" : "text-zinc-500")} />
                </div>
                <div className="text-left">
                  <p className={cn("text-sm font-black", persona === 'friendly' ? "text-white" : "text-zinc-300")}>Friendly Partner</p>
                  <p className={cn("text-[10px] font-medium", persona === 'friendly' ? "text-rose-100" : "text-zinc-500")}>Kind, humorous, like a friend</p>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ===== Pipeline Visualization: Training → Script Library → DM Auto-Reply ===== */}
      <div className="bg-[#111] border border-zinc-800/50 p-8 rounded-[2.5rem]">
        <div className="flex items-center gap-4 mb-8">
          <div className="w-12 h-12 bg-cyan-500/10 rounded-2xl flex items-center justify-center border border-cyan-500/20">
            <Zap className="w-6 h-6 text-cyan-500" />
          </div>
          <div>
            <h3 className="text-xl font-black tracking-tight">DM Auto-Reply Pipeline</h3>
            <p className="text-zinc-500 text-sm">Trained scripts → Bot DM auto-reply → Conversion tracking</p>
          </div>
        </div>

        <div className="grid grid-cols-5 gap-3 items-center">
          {[
            { icon: MessageSquare, label: 'Train Scripts', desc: 'ChatTrainer saves to library', color: 'text-green-500', bg: 'bg-green-500/10' },
            { icon: FileText, label: 'Script Library', desc: `${scriptLibrary.length} scripts ready`, color: 'text-blue-500', bg: 'bg-blue-500/10' },
            { icon: Bot, label: 'Bot DM Auto-Reply', desc: 'classifyIntent → pickAutoReply', color: 'text-amber-500', bg: 'bg-amber-500/10' },
            { icon: MessageCircle, label: 'Reply Received', desc: `${dmStats.replied || 0} replies`, color: 'text-purple-500', bg: 'bg-purple-500/10' },
            { icon: Target, label: 'Conversion', desc: `${dmConversionRate}% rate`, color: 'text-rose-500', bg: 'bg-rose-500/10' },
          ].map((step, i) => (
            <React.Fragment key={step.label}>
              <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-2xl p-4 text-center">
                <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-3", step.bg)}>
                  <step.icon className={cn("w-5 h-5", step.color)} />
                </div>
                <p className="text-xs font-black text-zinc-200">{step.label}</p>
                <p className="text-[10px] text-zinc-500 mt-1">{step.desc}</p>
              </div>
              {i < 4 && (
                <div className="flex items-center justify-center">
                  <ChevronRight className="w-5 h-5 text-zinc-700" />
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left Column: Data Acquisition & Context Training */}
        <div className="space-y-8">
          {/* Upload & Scrape Section */}
          <div className="bg-[#111] border border-zinc-800/50 p-8 rounded-[2.5rem]">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-blue-500/10 rounded-2xl flex items-center justify-center border border-blue-500/20">
                  <Upload className="w-6 h-6 text-blue-500" />
                </div>
                <div>
                  <h3 className="text-xl font-black tracking-tight">Upload / Scrape Data</h3>
                  <p className="text-zinc-500 text-sm">Support exporting chat history from Instagram and importing for training.</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div 
                {...getRootProps()} 
                className={cn(
                  "relative group cursor-pointer border-2 border-dashed rounded-3xl p-8 transition-all duration-300 flex flex-col items-center justify-center text-center",
                  isDragActive 
                    ? "border-blue-500 bg-blue-500/5" 
                    : "border-zinc-800 hover:border-zinc-700 bg-zinc-900/20"
                )}
              >
                <input {...getInputProps()} />
                <div className="w-12 h-12 bg-zinc-900 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform border border-zinc-800">
                  <Instagram className="w-6 h-6 text-blue-500" />
                </div>
                <h4 className="text-sm font-black mb-1">Drag & Drop Instagram exported JSON</h4>
                <p className="text-zinc-500 text-[10px] max-w-[150px]">
                  Supports .json, .txt formats
                </p>
              </div>

              <div className="space-y-4">
                <button 
                  onClick={() => setShowGuide(!showGuide)}
                  className="w-full p-6 bg-zinc-900/50 border border-zinc-800 hover:border-blue-500/30 rounded-3xl transition-all flex flex-col items-center justify-center text-center group"
                >
                  <div className="w-10 h-10 bg-zinc-800 rounded-xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                    <Terminal className="w-5 h-5 text-blue-500" />
                  </div>
                  <h4 className="text-sm font-black">Use Python Scraper Script</h4>
                  <p className="text-[10px] text-zinc-500 mt-1">Automatically traverse Inbox to extract conversations</p>
                </button>
              </div>
            </div>

            <AnimatePresence>
              {showGuide && (
                <motion.div 
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="mt-6 p-6 bg-zinc-900/80 border border-zinc-800 rounded-3xl overflow-hidden"
                >
                  <div className="flex items-center justify-between mb-4">
                    <h5 className="text-xs font-black text-zinc-300 uppercase tracking-widest">Python Scraper Guide</h5>
                    <button onClick={() => setShowGuide(false)} className="text-zinc-500 hover:text-white"><X className="w-4 h-4" /></button>
                  </div>
                  <div className="space-y-4">
                    <div className="p-4 bg-black rounded-xl border border-zinc-800">
                      <code className="text-[10px] text-blue-400 font-mono">
                        pip install selenium<br />
                        python ins_scraper.py
                      </code>
                    </div>
                    <p className="text-[10px] text-zinc-500 leading-relaxed">
                      After running the script, log in to Instagram in the pop-up browser. The script will automatically scrape all chat history and generate training files.
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="bg-[#111] border border-zinc-800/50 p-8 rounded-[2.5rem] space-y-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-xl font-black tracking-tight">Competitor Content Intelligence</h3>
                <p className="text-zinc-500 text-sm">1) Learn competitor posts 2) Breakdown high-performing patterns 3) Generate your weekly plan</p>
              </div>
              <button
                onClick={() => void loadContentIntel()}
                className="px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-xl text-xs font-black text-zinc-300 hover:bg-zinc-800 flex items-center gap-2"
              >
                <RefreshCw className={cn('w-3.5 h-3.5', contentLoading && 'animate-spin')} />
                Refresh
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-3">
                <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-black">Competitors</p>
                <p className="text-lg font-black text-blue-300">{competitors.length}</p>
              </div>
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-3">
                <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-black">Samples</p>
                <p className="text-lg font-black text-emerald-300">{contentSamples.length}</p>
              </div>
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-3">
                <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-black">Plans</p>
                <p className="text-lg font-black text-amber-300">{contentTemplates.length}</p>
              </div>
            </div>

            <textarea
              value={competitorHandlesText}
              onChange={(e) => setCompetitorHandlesText(e.target.value)}
              placeholder="@brand1, @brand2 or one handle per line"
              className="w-full h-24 p-4 bg-zinc-900/50 border border-zinc-800 focus:border-blue-500 rounded-2xl outline-none transition-all text-sm resize-none"
            />

            <div className="flex flex-wrap gap-2">
              <button onClick={() => void importCompetitorHandles()} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-black rounded-xl text-xs">1. Import Competitors</button>
              <button onClick={() => void ingestSamples()} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-black rounded-xl text-xs">2. Ingest Samples</button>
              <button onClick={() => void generateTemplates()} className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white font-black rounded-xl text-xs">3. Generate 7-Day Plan</button>
            </div>

            <div className="max-h-44 overflow-auto space-y-2 pr-1">
              {contentSamples.slice(0, 8).map((s) => (
                <div key={s.id} className="bg-zinc-950/70 border border-zinc-800 rounded-xl p-2.5 text-xs">
                  <div className="text-zinc-200 font-black">@{s.handle} <span className="text-zinc-500 font-medium ml-2">[{s.topic_tag}/{s.cta_tag}]</span></div>
                  <div className="text-zinc-500 mt-1 line-clamp-2">{s.caption}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-[#111] border border-zinc-800/50 p-8 rounded-[2.5rem] space-y-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-xl font-black tracking-tight">LLM Tasks & Latest Output</h3>
                <p className="text-zinc-500 text-sm">Real-time queue for comment/content pipelines</p>
              </div>
              <button
                onClick={() => void loadLlmTasks()}
                className="px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-xl text-xs font-black text-zinc-300 hover:bg-zinc-800 flex items-center gap-2"
              >
                <RefreshCw className={cn('w-3.5 h-3.5', llmLoading && 'animate-spin')} />
                Refresh
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-3">
                <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-black">Pending</p>
                <p className="text-lg font-black text-amber-300">{llmTasks.filter((t) => String(t.status) === 'pending').length}</p>
              </div>
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-3">
                <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-black">Done</p>
                <p className="text-lg font-black text-emerald-300">{llmTasks.filter((t) => String(t.status) === 'done').length}</p>
              </div>
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-3">
                <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-black">Failed</p>
                <p className="text-lg font-black text-red-300">{llmTasks.filter((t) => String(t.status) === 'failed').length}</p>
              </div>
            </div>

            <div className="max-h-72 overflow-auto pr-1">
              <table className="w-full text-xs">
                <thead className="text-zinc-500 uppercase tracking-widest">
                  <tr>
                    <th className="text-left py-2">Task</th>
                    <th className="text-left py-2">Pipeline</th>
                    <th className="text-left py-2">Status</th>
                    <th className="text-left py-2">Preview</th>
                  </tr>
                </thead>
                <tbody>
                  {llmTasks.slice(0, 20).map((t) => {
                    const payload = t?.payload && typeof t.payload === 'string' ? (() => { try { return JSON.parse(t.payload); } catch { return {}; } })() : (t?.payload || {});
                    const result = t?.result_json && typeof t.result_json === 'string' ? (() => { try { return JSON.parse(t.result_json); } catch { return {}; } })() : (t?.result_json || {});
                    const preview = String(result?.comment || result?.plan?.[0]?.hook || payload?.topic || '-');
                    return (
                      <tr key={t.id} className="border-t border-zinc-800">
                        <td className="py-2 text-zinc-300">{String(t.id || '').slice(0, 18)}...</td>
                        <td className="py-2 text-zinc-400">{String(t.pipeline || '-')}</td>
                        <td className="py-2">
                          <span className={cn(
                            "px-2 py-0.5 rounded border text-[10px] font-black uppercase tracking-widest",
                            String(t.status) === 'pending' && "bg-amber-600/20 border-amber-500/40 text-amber-200",
                            String(t.status) === 'done' && "bg-emerald-600/20 border-emerald-500/40 text-emerald-200",
                            String(t.status) === 'failed' && "bg-red-600/20 border-red-500/40 text-red-200",
                            !['pending','done','failed'].includes(String(t.status)) && "bg-zinc-700/30 border-zinc-600 text-zinc-300"
                          )}>{String(t.status || '-')}</span>
                        </td>
                        <td className="py-2 text-zinc-500 truncate max-w-[260px]">{preview}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Context Training Module */}
          <div className="bg-[#111] border border-zinc-800/50 p-8 rounded-[2.5rem]">
            <div className="flex items-center gap-4 mb-8">
              <div className="w-12 h-12 bg-green-500/10 rounded-2xl flex items-center justify-center border border-green-500/20">
                <Brain className="w-6 h-6 text-green-500" />
              </div>
              <div>
                <h3 className="text-xl font-black tracking-tight">Context Training</h3>
                <p className="text-zinc-500 text-sm">Deep learning for specific sales stages.</p>
              </div>
            </div>

            <div className="flex bg-zinc-900/50 p-1.5 rounded-2xl border border-zinc-800/50 mb-8">
              {(['ice-breaking', 'pricing', 'after-sales'] as Scenario[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setActiveScenario(s)}
                  className={cn(
                    "flex-1 py-3 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-2",
                    activeScenario === s 
                      ? "bg-zinc-800 text-white shadow-lg" 
                      : "text-zinc-500 hover:text-zinc-300"
                  )}
                >
                  {s === 'ice-breaking' && <SparklesIcon className="w-3.5 h-3.5" />}
                  {s === 'pricing' && <DollarSign className="w-3.5 h-3.5" />}
                  {s === 'after-sales' && <HeartHandshake className="w-3.5 h-3.5" />}
                  {s === 'ice-breaking' ? 'Ice-breaking' : s === 'pricing' ? 'Pricing' : 'After-sales'}
                </button>
              ))}
            </div>

            <div className="space-y-4">
              {/* Direction selector */}
              <div className="flex flex-wrap gap-2">
                {SCENARIO_DIRECTIONS[activeScenario].map(d => (
                  <button
                    key={d.value}
                    onClick={() => setScenarioDirection(prev => ({ ...prev, [activeScenario]: d.value }))}
                    className={cn(
                      "px-4 py-2 rounded-xl text-xs font-bold transition-all border",
                      scenarioDirection[activeScenario] === d.value
                        ? "bg-green-600/20 text-green-400 border-green-500/30 shadow-lg shadow-green-600/10"
                        : "bg-zinc-900/50 text-zinc-500 border-zinc-800 hover:text-zinc-300 hover:border-zinc-700"
                    )}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              <div className="relative">
                <textarea
                  value={scenarioData[activeScenario]}
                  onChange={(e) => setScenarioData(prev => ({ ...prev, [activeScenario]: e.target.value }))}
                  placeholder={`Enter or paste ideal scripts for the "${activeScenario === 'ice-breaking' ? 'Ice-breaking' : activeScenario === 'pricing' ? 'Pricing' : 'After-sales'}" scenario here...`}
                  className="w-full h-48 p-6 bg-zinc-900/50 border border-zinc-800 focus:border-green-500 rounded-[2rem] outline-none transition-all text-sm resize-none font-medium placeholder:text-zinc-700"
                />
                <div className="absolute bottom-6 right-6">
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-full">
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Learning...</span>
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={handleSaveScript}
                  disabled={scenarioSaving || !scenarioData[activeScenario]}
                  className="flex-1 py-4 bg-green-600 hover:bg-green-500 disabled:bg-zinc-800 text-white font-black rounded-2xl transition-all shadow-xl shadow-green-600/20 flex items-center justify-center gap-3"
                >
                  {scenarioSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                  Save to Script Library
                </button>
                <button
                  onClick={handleTrain}
                  disabled={isTraining || !scenarioData[activeScenario]}
                  className="py-4 px-6 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-300 font-black rounded-2xl transition-all flex items-center justify-center gap-3"
                >
                  {isTraining ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
                  Train AI
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Preview Window */}
        <div className="space-y-8">
          <div className="bg-[#111] border border-zinc-800/50 p-8 rounded-[2.5rem] flex flex-col h-full min-h-[700px]">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-rose-500/10 rounded-2xl flex items-center justify-center border border-rose-500/20">
                  <MessageCircle className="w-6 h-6 text-rose-500" />
                </div>
                <div>
                  <h3 className="text-xl font-black tracking-tight">AI Preview Test (Live Preview)</h3>
                  <p className="text-zinc-500 text-sm">Test AI response performance in different scenarios.</p>
                </div>
              </div>
              <button 
                onClick={() => setTestMessages([{ role: 'ai', content: 'Hello! I am your AI assistant. I am ready to answer your questions based on the training results.' }])}
                className="p-3 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-xl text-zinc-500 hover:text-white transition-all"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 bg-zinc-900/30 border border-zinc-800 rounded-[2rem] p-6 flex flex-col gap-4 overflow-y-auto mb-6 max-h-[500px] scrollbar-hide">
              {testMessages.map((msg, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  className={cn(
                    "max-w-[85%] p-4 rounded-2xl text-sm font-medium leading-relaxed shadow-sm",
                    msg.role === 'user' 
                      ? "ml-auto bg-rose-600 text-white rounded-tr-none" 
                      : "mr-auto bg-zinc-800 text-zinc-200 border border-zinc-700 rounded-tl-none"
                  )}
                >
                  {msg.content}
                </motion.div>
              ))}
              {isTesting && (
                <div className="mr-auto bg-zinc-800 p-4 rounded-2xl rounded-tl-none border border-zinc-700 flex items-center gap-2">
                  <div className="flex gap-1">
                    <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1 }} className="w-1.5 h-1.5 bg-zinc-500 rounded-full" />
                    <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1, delay: 0.2 }} className="w-1.5 h-1.5 bg-zinc-500 rounded-full" />
                    <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1, delay: 0.4 }} className="w-1.5 h-1.5 bg-zinc-500 rounded-full" />
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="flex gap-3">
                <div className="flex-1 relative">
                  <input 
                    type="text" 
                    value={testQuery}
                    onChange={(e) => setTestQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleTest()}
                    placeholder="e.g., Do your needles spray ink?"
                    className="w-full pl-6 pr-12 py-5 bg-zinc-900 border border-zinc-800 focus:border-rose-500 rounded-2xl outline-none transition-all text-sm font-bold"
                  />
                  <button 
                    onClick={handleTest}
                    disabled={isTesting || !testQuery}
                    className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-rose-600 hover:bg-rose-500 disabled:bg-zinc-800 text-white rounded-xl flex items-center justify-center transition-all"
                  >
                    {isTesting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button 
                  onClick={() => setTestQuery('Do your needles spray ink?')}
                  className="px-3 py-1.5 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-lg text-[10px] font-black text-zinc-500 hover:text-zinc-300 transition-all"
                >
                  Test: Ink Spray Issue
                </button>
                <button 
                  onClick={() => setTestQuery('How much for a tattoo?')}
                  className="px-3 py-1.5 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-lg text-[10px] font-black text-zinc-500 hover:text-zinc-300 transition-all"
                >
                  Test: Pricing
                </button>
                <button 
                  onClick={() => setTestQuery('How to care for a new tattoo?')}
                  className="px-3 py-1.5 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-lg text-[10px] font-black text-zinc-500 hover:text-zinc-300 transition-all"
                >
                  Test: After-care
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ===== Script Library ===== */}
      <div className="bg-[#111] border border-zinc-800/50 p-8 rounded-[2.5rem]">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-500/10 rounded-2xl flex items-center justify-center border border-blue-500/20">
              <FileText className="w-6 h-6 text-blue-500" />
            </div>
            <div>
              <h3 className="text-xl font-black tracking-tight">Script Library</h3>
              <p className="text-zinc-500 text-sm">{scriptLibrary.length} scripts — used by DM auto-reply</p>
            </div>
          </div>
          <button
            onClick={() => void loadScriptLibrary()}
            className="px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-xl text-xs font-black text-zinc-300 hover:bg-zinc-800 flex items-center gap-2"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', scriptLibLoading && 'animate-spin')} />
            Refresh
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-zinc-500 uppercase tracking-widest">
              <tr>
                <th className="text-left py-3 pr-2">ID</th>
                <th className="text-left py-3 pr-2">Category</th>
                <th className="text-left py-3 pr-2">Direction</th>
                <th className="text-left py-3 pr-2">Title</th>
                <th className="text-left py-3 pr-2">Tone</th>
                <th className="text-center py-3 pr-2">Usage</th>
                <th className="text-center py-3 pr-2">Success</th>
                <th className="text-center py-3 pr-2">Active</th>
                <th className="text-right py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {scriptLibrary.length === 0 ? (
                <tr><td colSpan={9} className="py-8 text-center text-zinc-600 font-medium">No scripts saved yet. Write and save one above.</td></tr>
              ) : scriptLibrary.map((s: any) => (
                <tr key={s.id} className="border-t border-zinc-800/50 hover:bg-zinc-900/30 transition-colors">
                  <td className="py-3 pr-2 text-zinc-500">#{s.id}</td>
                  <td className="py-3 pr-2">
                    <span className={cn(
                      "px-2 py-0.5 rounded-full text-[10px] font-bold",
                      s.category === 'product_intro' && "bg-rose-500/10 text-rose-300 border border-rose-500/20",
                      s.category === 'collaboration' && "bg-purple-500/10 text-purple-300 border border-purple-500/20",
                      s.category === 'industry_talk' && "bg-amber-500/10 text-amber-300 border border-amber-500/20",
                      s.category === 'after_sales' && "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20",
                    )}>{s.category}</span>
                  </td>
                  <td className="py-3 pr-2 text-zinc-300 font-medium">{s.direction}</td>
                  <td className="py-3 pr-2 text-zinc-400 max-w-[180px] truncate">{s.title}</td>
                  <td className="py-3 pr-2 text-zinc-500">{s.tone}</td>
                  <td className="py-3 pr-2 text-center text-zinc-300">{s.usage_count || 0}</td>
                  <td className="py-3 pr-2 text-center">
                    <span className={cn(
                      "font-bold",
                      (s.success_rate || 0) >= 0.5 ? "text-emerald-400" : (s.success_rate || 0) > 0 ? "text-amber-400" : "text-zinc-600"
                    )}>
                      {s.success_rate ? `${Math.round(Number(s.success_rate) * 100)}%` : '-'}
                    </span>
                  </td>
                  <td className="py-3 pr-2 text-center">
                    <div className={cn("w-2 h-2 rounded-full mx-auto", s.active ? "bg-green-500" : "bg-zinc-700")} />
                  </td>
                  <td className="py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => handleEditScript(s)}
                        className="p-1.5 hover:bg-zinc-800 rounded-lg text-zinc-500 hover:text-blue-400 transition-colors"
                        title="Edit"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteScript(s.id)}
                        disabled={scriptDeleteId === s.id}
                        className="p-1.5 hover:bg-zinc-800 rounded-lg text-zinc-500 hover:text-red-400 transition-colors"
                        title="Delete"
                      >
                        {scriptDeleteId === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ===== DM Pipeline History ===== */}
      <div className="bg-[#111] border border-zinc-800/50 p-8 rounded-[2.5rem]">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-purple-500/10 rounded-2xl flex items-center justify-center border border-purple-500/20">
              <MessageCircle className="w-6 h-6 text-purple-500" />
            </div>
            <div>
              <h3 className="text-xl font-black tracking-tight">DM Pipeline History</h3>
              <p className="text-zinc-500 text-sm">Marketing tasks: follow-back → DM sent → reply → conversion</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex gap-2 text-[10px] font-black">
              <span className="px-2 py-1 bg-amber-500/10 text-amber-300 rounded-lg border border-amber-500/20">Pending: {dmStats.pending || 0}</span>
              <span className="px-2 py-1 bg-blue-500/10 text-blue-300 rounded-lg border border-blue-500/20">Sent: {dmStats.sent || 0}</span>
              <span className="px-2 py-1 bg-purple-500/10 text-purple-300 rounded-lg border border-purple-500/20">Replied: {dmStats.replied || 0}</span>
              <span className="px-2 py-1 bg-emerald-500/10 text-emerald-300 rounded-lg border border-emerald-500/20">Converted: {dmStats.converted || 0}</span>
              <span className={cn("px-2 py-1 rounded-lg border font-black",
                dmConversionRate >= 20 ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/20" : "bg-zinc-800 text-zinc-400 border-zinc-700"
              )}>CV: {dmConversionRate}%</span>
            </div>
            <button
              onClick={() => void loadDmHistory()}
              className="px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-xl text-xs font-black text-zinc-300 hover:bg-zinc-800 flex items-center gap-2"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', dmHistoryLoading && 'animate-spin')} />
              Refresh
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-zinc-500 uppercase tracking-widest">
              <tr>
                <th className="text-left py-3 pr-2">Target</th>
                <th className="text-left py-3 pr-2">Category</th>
                <th className="text-left py-3 pr-2">Script</th>
                <th className="text-center py-3 pr-2">Status</th>
                <th className="text-center py-3 pr-2">Score</th>
                <th className="text-center py-3 pr-2">Touches</th>
                <th className="text-right py-3">Timeline</th>
                <th className="text-right py-3 w-20">Actions</th>
              </tr>
            </thead>
            <tbody>
              {dmHistory.length === 0 ? (
                <tr><td colSpan={8} className="py-8 text-center text-zinc-600 font-medium">No DM tasks yet. Follow-backs will auto-create marketing tasks.</td></tr>
              ) : dmHistory.map((t: any) => (
                <tr key={t.id} className="border-t border-zinc-800/50 hover:bg-zinc-900/30 transition-colors">
                  <td className="py-3 pr-2">
                    <div>
                      <span className="text-zinc-200 font-medium">@{t.target_handle}</span>
                      {t.target_name && <p className="text-zinc-600 text-[10px]">{t.target_name}</p>}
                    </div>
                  </td>
                  <td className="py-3 pr-2">
                    <span className={cn(
                      "px-2 py-0.5 rounded-full text-[10px] font-bold",
                      t.category === 'product_intro' && "bg-rose-500/10 text-rose-300",
                      t.category === 'collaboration' && "bg-purple-500/10 text-purple-300",
                      t.category === 'industry_talk' && "bg-amber-500/10 text-amber-300",
                      t.category === 'after_sales' && "bg-emerald-500/10 text-emerald-300",
                    )}>{t.category}</span>
                  </td>
                  <td className="py-3 pr-2 text-zinc-500 max-w-[200px] truncate">
                    {t.script_id ? `#${t.script_id}` : 'AI-gen'}
                  </td>
                  <td className="py-3 pr-2 text-center">
                    <span className={cn(
                      "px-2 py-0.5 rounded border text-[10px] font-black uppercase tracking-widest",
                      t.status === 'pending' && "bg-amber-600/20 border-amber-500/40 text-amber-200",
                      t.status === 'sent' && "bg-blue-600/20 border-blue-500/40 text-blue-200",
                      t.status === 'replied' && "bg-purple-600/20 border-purple-500/40 text-purple-200",
                      t.status === 'converted' && "bg-emerald-600/20 border-emerald-500/40 text-emerald-200",
                      t.status === 'failed' && "bg-red-600/20 border-red-500/40 text-red-200",
                    )}>{t.status}</span>
                  </td>
                  <td className="py-3 pr-2 text-center text-zinc-300">{t.lead_score || 0}</td>
                  <td className="py-3 pr-2 text-center text-zinc-300">{t.touch_count || 0}</td>
                  <td className="py-3 text-right text-zinc-500">
                    <div className="flex flex-col items-end gap-0.5">
                      {t.sent_at && <span className="text-[10px]">Sent: {new Date(t.sent_at).toLocaleDateString()}</span>}
                      {t.reply_at && <span className="text-[10px] text-purple-400">Reply: {new Date(t.reply_at).toLocaleDateString()}</span>}
                      {t.converted_at && <span className="text-[10px] text-emerald-400">Converted: {new Date(t.converted_at).toLocaleDateString()}</span>}
                      {!t.sent_at && <span className="text-[10px] text-zinc-600">{new Date(t.created_at).toLocaleDateString()}</span>}
                    </div>
                  </td>
                  <td className="py-3 text-right">
                    <button
                      onClick={() => setSelectedConversation(t)}
                      className="px-2.5 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg text-[9px] font-black text-zinc-400 hover:text-zinc-200 transition-all flex items-center gap-1 ml-auto"
                    >
                      <MessageCircle className="w-3 h-3" />
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Conversation Modal */}
      {selectedConversation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setSelectedConversation(null)}>
          <div className="bg-[#1a1a1a] border border-zinc-800 rounded-2xl p-6 max-w-lg w-full shadow-2xl max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-purple-500/10 rounded-xl flex items-center justify-center border border-purple-500/20">
                  <MessageCircle className="w-5 h-5 text-purple-500" />
                </div>
                <div>
                  <h4 className="font-black text-white text-sm">DM Conversation</h4>
                  <p className="text-[10px] text-zinc-500">@{selectedConversation.target_handle}{selectedConversation.target_name ? ` (${selectedConversation.target_name})` : ''}</p>
                </div>
              </div>
              <button onClick={() => setSelectedConversation(null)} className="p-1.5 hover:bg-zinc-800 rounded-lg transition-colors">
                <X className="w-4 h-4 text-zinc-500" />
              </button>
            </div>

            {/* Status & Meta */}
            <div className="flex items-center gap-2 mb-4 p-3 bg-zinc-900/40 border border-zinc-800 rounded-xl">
              <span className={cn(
                "px-2 py-0.5 rounded border text-[9px] font-black uppercase tracking-widest",
                selectedConversation.status === 'converted' && "bg-emerald-600/20 border-emerald-500/40 text-emerald-200",
                selectedConversation.status === 'replied' && "bg-purple-600/20 border-purple-500/40 text-purple-200",
                selectedConversation.status === 'sent' && "bg-blue-600/20 border-blue-500/40 text-blue-200",
                selectedConversation.status === 'pending' && "bg-amber-600/20 border-amber-500/40 text-amber-200",
                selectedConversation.status === 'failed' && "bg-red-600/20 border-red-500/40 text-red-200",
              )}>{selectedConversation.status}</span>
              {selectedConversation.category && <span className="text-[10px] text-zinc-500">{selectedConversation.category}</span>}
              {selectedConversation.script_id && <span className="text-[10px] text-zinc-600 ml-auto">Script #{selectedConversation.script_id}</span>}
            </div>

            {/* Timeline */}
            <div className="mb-4 p-3 bg-zinc-900/40 border border-zinc-800 rounded-xl">
              <h5 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">Timeline</h5>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {[
                  { label: 'Created', time: selectedConversation.created_at },
                  { label: 'Sent', time: selectedConversation.sent_at },
                  { label: 'Replied', time: selectedConversation.reply_at },
                  { label: 'Converted', time: selectedConversation.converted_at },
                ].filter(e => e.time).map((e) => (
                  <div key={e.label} className="flex items-center gap-1.5">
                    <div className={cn(
                      "w-1.5 h-1.5 rounded-full",
                      e.label === 'Converted' ? "bg-emerald-500" :
                      e.label === 'Replied' ? "bg-purple-500" :
                      e.label === 'Sent' ? "bg-blue-500" :
                      "bg-zinc-600"
                    )} />
                    <span className="text-[10px] text-zinc-400">
                      {e.label}: <strong className="text-zinc-300">{new Date(e.time).toLocaleString()}</strong>
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Sent DM */}
            {selectedConversation.script_content && (
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <Send className="w-3 h-3 text-blue-500" />
                  <h5 className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Sent DM</h5>
                </div>
                <div className="p-3 bg-blue-500/5 border border-blue-500/20 rounded-xl">
                  <p className="text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed">{selectedConversation.script_content}</p>
                </div>
              </div>
            )}

            {/* Reply Received */}
            {selectedConversation.reply_text && (
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <MessageCircle className="w-3 h-3 text-purple-500" />
                  <h5 className="text-[10px] font-black text-purple-400 uppercase tracking-widest">Reply Received</h5>
                </div>
                <div className="p-3 bg-purple-500/5 border border-purple-500/20 rounded-xl">
                  <p className="text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed">{selectedConversation.reply_text}</p>
                </div>
              </div>
            )}

            {/* Conversation Log */}
            {Array.isArray(selectedConversation.conversation_log) && selectedConversation.conversation_log.length > 0 && (
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <MessageCircle className="w-3 h-3 text-amber-500" />
                  <h5 className="text-[10px] font-black text-amber-400 uppercase tracking-widest">Full Conversation Log</h5>
                </div>
                <div className="space-y-2">
                  {selectedConversation.conversation_log.map((entry: any, i: number) => (
                    <div key={i} className={cn(
                      "p-2.5 rounded-xl border text-xs",
                      entry.role === 'bot' ? "bg-blue-500/5 border-blue-500/20 ml-4" :
                      entry.role === 'target' ? "bg-purple-500/5 border-purple-500/20 mr-4" :
                      "bg-zinc-900/40 border-zinc-800"
                    )}>
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className={cn(
                          "text-[8px] font-black uppercase tracking-widest",
                          entry.role === 'bot' ? "text-blue-500" :
                          entry.role === 'target' ? "text-purple-500" :
                          "text-zinc-600"
                        )}>
                          {entry.role === 'bot' ? 'Bot' : entry.role === 'target' ? 'Customer' : entry.role || 'System'}
                        </span>
                        {entry.timestamp && <span className="text-[8px] text-zinc-700">{new Date(entry.timestamp).toLocaleString()}</span>}
                      </div>
                      <p className="text-zinc-300 whitespace-pre-wrap leading-relaxed">{entry.message || entry.text || ''}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* No content yet */}
            {!selectedConversation.script_content && !selectedConversation.reply_text && (!Array.isArray(selectedConversation.conversation_log) || selectedConversation.conversation_log.length === 0) && (
              <div className="p-6 text-center text-zinc-600 text-xs font-medium">
                <p>Task created but DM not yet sent. Status: {selectedConversation.status}</p>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
