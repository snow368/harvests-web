import React, { useState } from 'react';
import { 
  Settings, 
  Shield, 
  Clock, 
  Zap, 
  AlertTriangle, 
  CheckCircle2,
  Instagram,
  MessageSquare,
  UserPlus,
  Heart,
  Plus,
  Trash2,
  Tag,
  FlaskConical,
  UserCircle,
  ShieldCheck,
  Handshake
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useCRM } from '../contexts/CRMContext';

interface KeywordRule {
  id: string;
  keyword: string;
  response: string;
}

export default function AutomationSettings() {
  const { 
    mockMode, 
    setMockMode, 
    debugMode, 
    setDebugMode, 
    seedTestData, 
    simulateInteraction,
    artists,
    persona,
    setPersona,
    clearAllData,
    cleanupOldFirestoreData,
  } = useCRM();
  const [speed, setSpeed] = useState('safe');
  const [selectedArtistId, setSelectedArtistId] = useState<string>('');
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [limits, setLimits] = useState({
    likes: 50,
    follows: 20,
    comments: 30,
    dms: 15
  });

  const [keywordRules, setKeywordRules] = useState<KeywordRule[]>([
    { id: '1', keyword: 'wholesale', response: 'For bulk orders and wholesale inquiries, please send an email to support@peachtattoosupplies.com' },
    { id: '2', keyword: 'bulk', response: 'For bulk orders and wholesale inquiries, please send an email to support@peachtattoosupplies.com' },
    { id: '3', keyword: 'distributor', response: 'For bulk orders and wholesale inquiries, please send an email to support@peachtattoosupplies.com' }
  ]);

  const [newKeyword, setNewKeyword] = useState('');
  const [newResponse, setNewResponse] = useState('');

  const addRule = () => {
    if (!newKeyword || !newResponse) return;
    const newRule: KeywordRule = {
      id: Math.random().toString(36).substr(2, 9),
      keyword: newKeyword,
      response: newResponse
    };
    setKeywordRules([...keywordRules, newRule]);
    setNewKeyword('');
    setNewResponse('');
  };

  const removeRule = (id: string) => {
    setKeywordRules(keywordRules.filter(r => r.id !== id));
  };

  const speeds = [
    { id: 'safe', label: 'Safe', icon: Shield, desc: 'Slow & steady. Minimal risk of ban.', color: 'text-green-500', bg: 'bg-green-500/10', border: 'border-green-500/20' },
    { id: 'balanced', label: 'Balanced', icon: Clock, desc: 'Moderate speed. Recommended for aged accounts.', color: 'text-rose-500', bg: 'bg-rose-500/10', border: 'border-rose-500/20' },
    { id: 'aggressive', label: 'Aggressive', icon: Zap, desc: 'High speed. Use with caution.', color: 'text-amber-500', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-20">
      {/* Developer / Mock Mode Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-[#111] border border-rose-500/20 p-8 rounded-3xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-rose-600/5 blur-[40px] -mr-16 -mt-16 rounded-full" />
          <div className="flex items-center justify-between relative z-10">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-rose-600/10 rounded-2xl flex items-center justify-center border border-rose-500/20">
                <FlaskConical className="w-6 h-6 text-rose-500" />
              </div>
              <div>
                <h3 className="text-xl font-bold tracking-tight">Mock Mode</h3>
                <p className="text-zinc-500 text-sm">Simulate API delays.</p>
              </div>
            </div>
            <button 
              onClick={() => setMockMode(!mockMode)}
              className={cn(
                "w-14 h-8 rounded-full transition-all relative",
                mockMode ? "bg-rose-600" : "bg-zinc-800"
              )}
            >
              <div className={cn(
                "absolute top-1 w-6 h-6 bg-white rounded-full transition-all",
                mockMode ? "left-7" : "left-1"
              )} />
            </button>
          </div>
        </div>

        <div className="bg-[#111] border border-amber-500/20 p-8 rounded-3xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-amber-600/5 blur-[40px] -mr-16 -mt-16 rounded-full" />
          <div className="flex items-center justify-between relative z-10">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-amber-600/10 rounded-2xl flex items-center justify-center border border-amber-500/20">
                <Shield className="w-6 h-6 text-amber-500" />
              </div>
              <div>
                <h3 className="text-xl font-bold tracking-tight">Debug Mode</h3>
                <p className="text-zinc-500 text-sm">Enable manual heat simulation.</p>
              </div>
            </div>
            <button 
              onClick={() => setDebugMode(!debugMode)}
              className={cn(
                "w-14 h-8 rounded-full transition-all relative",
                debugMode ? "bg-amber-600" : "bg-zinc-800"
              )}
            >
              <div className={cn(
                "absolute top-1 w-6 h-6 bg-white rounded-full transition-all",
                debugMode ? "left-7" : "left-1"
              )} />
            </button>
          </div>
        </div>
      </div>

      {debugMode && (
        <div className="bg-zinc-900/50 border border-amber-500/30 p-8 rounded-3xl space-y-6 animate-in fade-in slide-in-from-top-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-bold text-amber-500 flex items-center gap-2">
              <Zap className="w-5 h-5" />
              Debug Control Panel
            </h3>
            <div className="flex items-center gap-3">
              {showClearConfirm ? (
                <div className="flex items-center gap-2 animate-in fade-in zoom-in duration-200">
                  <span className="text-[10px] font-black text-rose-500 uppercase tracking-widest mr-2">Are you sure?</span>
                  <button 
                    onClick={() => {
                      clearAllData();
                      setShowClearConfirm(false);
                    }}
                    className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-xl transition-all"
                  >
                    Yes, Clear All
                  </button>
                  <button 
                    onClick={() => setShowClearConfirm(false)}
                    className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs font-bold rounded-xl transition-all"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button 
                  onClick={() => setShowClearConfirm(true)}
                  className="px-4 py-2 bg-zinc-900/50 hover:bg-rose-600/10 text-rose-500 text-xs font-bold rounded-xl border border-rose-500/20 transition-all flex items-center gap-2"
                >
                  <Trash2 className="w-3 h-3" />
                  Clear Data
                </button>
              )}
              <button
                onClick={cleanupOldFirestoreData}
                className="px-4 py-2 bg-zinc-900/50 hover:bg-green-600/10 text-green-500 text-xs font-bold rounded-xl border border-green-500/20 transition-all flex items-center gap-2"
              >
                <Trash2 className="w-3 h-3" />
                Clean Up Old FS Data
              </button>
              <button 
                onClick={seedTestData}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-bold rounded-xl border border-zinc-700 transition-all"
              >
                Seed Test Data
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Select Artist to Test</label>
              <select 
                value={selectedArtistId}
                onChange={(e) => setSelectedArtistId(e.target.value)}
                className="w-full px-4 py-3 bg-zinc-950 border border-zinc-800 rounded-xl outline-none focus:border-amber-500 transition-all text-sm text-zinc-300"
              >
                <option value="">-- Choose an Artist --</option>
                {artists.map(a => (
                  <option key={a.id} value={a.id}>@{a.username} (Heat: {a.heatScore})</option>
                ))}
              </select>
            </div>

            <div className="flex items-end gap-3">
              <button 
                disabled={!selectedArtistId}
                onClick={() => simulateInteraction(selectedArtistId, 5)}
                className="flex-1 px-4 py-3 bg-amber-600/10 hover:bg-amber-600/20 text-amber-500 border border-amber-500/20 rounded-xl text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Simulate: View Story (+5)
              </button>
              <button 
                disabled={!selectedArtistId}
                onClick={() => simulateInteraction(selectedArtistId, 10)}
                className="flex-1 px-4 py-3 bg-rose-600/10 hover:bg-rose-600/20 text-rose-500 border border-rose-500/20 rounded-xl text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Simulate: Like (+10)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Persona Section */}
      <div className="bg-[#111] border border-zinc-800/50 p-8 rounded-3xl">
        <div className="flex items-center gap-4 mb-8">
          <div className="w-12 h-12 bg-amber-500/10 rounded-2xl flex items-center justify-center border border-amber-500/20">
            <UserCircle className="w-6 h-6 text-amber-500" />
          </div>
          <div>
            <h3 className="text-xl font-bold tracking-tight">AI Outreach Persona</h3>
            <p className="text-zinc-500 text-sm">Choose the tone and style of your AI assistant.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button 
            onClick={() => setPersona('professional')}
            className={cn(
              "p-6 rounded-2xl border transition-all flex items-center gap-4 group",
              persona === 'professional' 
                ? "bg-rose-600 border-rose-500 shadow-lg shadow-rose-600/20" 
                : "bg-zinc-900 border-zinc-800 hover:border-zinc-700"
            )}
          >
            <div className={cn(
              "w-12 h-12 rounded-xl flex items-center justify-center transition-colors",
              persona === 'professional' ? "bg-white/20" : "bg-zinc-800 group-hover:bg-zinc-700"
            )}>
              <ShieldCheck className={cn("w-6 h-6", persona === 'professional' ? "text-white" : "text-zinc-500")} />
            </div>
            <div className="text-left">
              <p className={cn("text-base font-black", persona === 'professional' ? "text-white" : "text-zinc-300")}>Professional Consultant</p>
              <p className={cn("text-xs font-medium", persona === 'professional' ? "text-rose-100" : "text-zinc-500")}>Rigorous, professional, trustworthy</p>
            </div>
          </button>

          <button 
            onClick={() => setPersona('friendly')}
            className={cn(
              "p-6 rounded-2xl border transition-all flex items-center gap-4 group",
              persona === 'friendly' 
                ? "bg-rose-600 border-rose-500 shadow-lg shadow-rose-600/20" 
                : "bg-zinc-900 border-zinc-800 hover:border-zinc-700"
            )}
          >
            <div className={cn(
              "w-12 h-12 rounded-xl flex items-center justify-center transition-colors",
              persona === 'friendly' ? "bg-white/20" : "bg-zinc-800 group-hover:bg-zinc-700"
            )}>
              <Handshake className={cn("w-6 h-6", persona === 'friendly' ? "text-white" : "text-zinc-500")} />
            </div>
            <div className="text-left">
              <p className={cn("text-base font-black", persona === 'friendly' ? "text-white" : "text-zinc-300")}>Friendly Partner</p>
              <p className={cn("text-xs font-medium", persona === 'friendly' ? "text-rose-100" : "text-zinc-500")}>Kind, humorous, like a friend</p>
            </div>
          </button>
        </div>
      </div>

      {/* Keyword Rules Section */}
      <div className="bg-[#111] border border-zinc-800/50 p-8 rounded-3xl">
        <div className="flex items-center gap-4 mb-8">
          <div className="w-12 h-12 bg-rose-600/10 rounded-2xl flex items-center justify-center border border-rose-500/20">
            <Tag className="w-6 h-6 text-rose-500" />
          </div>
          <div>
            <h3 className="text-xl font-bold tracking-tight">Keyword Triggers</h3>
            <p className="text-zinc-500 text-sm">Set up specific responses for keywords like "wholesale" or "bulk".</p>
          </div>
        </div>

        <div className="space-y-4 mb-8">
          {keywordRules.map((rule) => (
            <div key={rule.id} className="flex items-start gap-4 p-4 bg-zinc-900/50 border border-zinc-800 rounded-2xl group">
              <div className="flex-1">
                <p className="text-xs font-bold text-rose-500 uppercase tracking-widest mb-1">Keyword: {rule.keyword}</p>
                <p className="text-sm text-zinc-300">"{rule.response}"</p>
              </div>
              <button 
                onClick={() => removeRule(rule.id)}
                className="p-2 text-zinc-500 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-6 bg-zinc-900/30 border border-zinc-800 rounded-2xl">
          <div className="space-y-2">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">New Keyword</label>
            <input 
              type="text" 
              value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
              placeholder="e.g. wholesale"
              className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl outline-none focus:border-rose-500 transition-all text-sm"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Auto-Response</label>
            <input 
              type="text" 
              value={newResponse}
              onChange={(e) => setNewResponse(e.target.value)}
              placeholder="e.g. Contact support@..."
              className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl outline-none focus:border-rose-500 transition-all text-sm"
            />
          </div>
          <div className="md:col-span-2 flex justify-end pt-2">
            <button 
              onClick={addRule}
              className="px-6 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl transition-all flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Add Rule
            </button>
          </div>
        </div>
      </div>

      {/* Speed Selector */}
      <div className="bg-[#111] border border-zinc-800/50 p-8 rounded-3xl">
        <div className="flex items-center gap-4 mb-8">
          <div className="w-12 h-12 bg-rose-600/10 rounded-2xl flex items-center justify-center border border-rose-500/20">
            <Settings className="w-6 h-6 text-rose-500" />
          </div>
          <div>
            <h3 className="text-xl font-bold tracking-tight">Automation Speed</h3>
            <p className="text-zinc-500 text-sm">Control how fast the AI interacts with artists and shops.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {speeds.map((s) => {
            const Icon = s.icon;
            const isActive = speed === s.id;
            return (
              <button
                key={s.id}
                onClick={() => setSpeed(s.id)}
                className={cn(
                  "p-6 rounded-2xl border text-left transition-all duration-300",
                  isActive 
                    ? `${s.bg} ${s.border}` 
                    : "bg-zinc-900/50 border-zinc-800 hover:border-zinc-700"
                )}
              >
                <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center mb-4", isActive ? s.bg : "bg-zinc-800")}>
                  <Icon className={cn("w-5 h-5", isActive ? s.color : "text-zinc-500")} />
                </div>
                <h4 className={cn("font-bold mb-1", isActive ? s.color : "text-zinc-300")}>{s.label}</h4>
                <p className="text-xs text-zinc-500 leading-relaxed">{s.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Daily Limits */}
      <div className="bg-[#111] border border-zinc-800/50 p-8 rounded-3xl">
        <h3 className="text-lg font-bold mb-8 flex items-center gap-2">
          <Shield className="w-5 h-5 text-rose-500" />
          Daily Safety Limits
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-6">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-zinc-400 flex items-center gap-2">
                  <Heart className="w-4 h-4" />
                  Max Likes / Day
                </label>
                <span className="text-sm font-bold text-rose-500">{limits.likes}</span>
              </div>
              <input 
                type="range" 
                min="10" 
                max="200" 
                value={limits.likes}
                onChange={(e) => setLimits({...limits, likes: parseInt(e.target.value)})}
                className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-rose-600"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-zinc-400 flex items-center gap-2">
                  <UserPlus className="w-4 h-4" />
                  Max Follows / Day
                </label>
                <span className="text-sm font-bold text-rose-500">{limits.follows}</span>
              </div>
              <input 
                type="range" 
                min="5" 
                max="100" 
                value={limits.follows}
                onChange={(e) => setLimits({...limits, follows: parseInt(e.target.value)})}
                className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-rose-600"
              />
            </div>
          </div>

          <div className="space-y-6">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-zinc-400 flex items-center gap-2">
                  <Instagram className="w-4 h-4" />
                  Max Comments / Day
                </label>
                <span className="text-sm font-bold text-rose-500">{limits.comments}</span>
              </div>
              <input 
                type="range" 
                min="5" 
                max="100" 
                value={limits.comments}
                onChange={(e) => setLimits({...limits, comments: parseInt(e.target.value)})}
                className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-rose-600"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-zinc-400 flex items-center gap-2">
                  <MessageSquare className="w-4 h-4" />
                  Max DMs / Day
                </label>
                <span className="text-sm font-bold text-rose-500">{limits.dms}</span>
              </div>
              <input 
                type="range" 
                min="5" 
                max="50" 
                value={limits.dms}
                onChange={(e) => setLimits({...limits, dms: parseInt(e.target.value)})}
                className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-rose-600"
              />
            </div>
          </div>
        </div>

        <div className="mt-10 p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-start gap-4">
          <AlertTriangle className="w-6 h-6 text-amber-500 shrink-0" />
          <p className="text-xs text-amber-500/80 leading-relaxed">
            <span className="font-bold">Warning:</span> Exceeding recommended limits may result in temporary action blocks or permanent account suspension by Instagram. We recommend starting with "Safe" speed for at least 7 days.
          </p>
        </div>
      </div>

      <div className="flex justify-end">
        <button className="px-8 py-4 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-2xl transition-all shadow-lg shadow-rose-600/20 flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5" />
          Save Settings
        </button>
      </div>
    </div>
  );
}
