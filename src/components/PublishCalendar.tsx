import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Image, CheckCircle2, Clock, AlertTriangle, Loader2, RefreshCw, Send, X } from 'lucide-react';
import { cn } from '../lib/utils';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

const STATUS_COLORS: Record<string, string> = {
  done: 'bg-emerald-500',
  pending: 'bg-amber-500',
  scheduled: 'bg-blue-500',
  pending_media: 'bg-rose-500',
  failed: 'bg-zinc-600',
  leased: 'bg-purple-500',
};

const STATUS_LABELS: Record<string, string> = {
  done: 'Published',
  pending: 'Pending',
  scheduled: 'Scheduled',
  pending_media: 'Needs Media',
  failed: 'Failed',
  leased: 'In Progress',
};

export default function PublishCalendar() {
  const [now] = useState(new Date());
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTask, setSelectedTask] = useState<any>(null);

  const loadTasks = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/publish/tasks?limit=500');
      if (res.ok) {
        const data = await res.json();
        setTasks(Array.isArray(data?.rows) ? data.rows : []);
      }
    } catch {}
    setLoading(false);
  };

  useEffect(() => { void loadTasks(); }, []);

  // Calendar math
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const prevMonth = () => { if (month === 0) { setYear(y => y - 1); setMonth(11); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 11) { setYear(y => y + 1); setMonth(0); } else setMonth(m => m + 1); };

  // Map tasks to dates
  const taskMap: Record<string, any[]> = {};
  for (const t of tasks) {
    const date = new Date(Number(t.scheduled_at) || Number(t.created_at));
    if (isNaN(date.getTime())) continue;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    if (!taskMap[key]) taskMap[key] = [];
    let caption = '';
    try {
      const p = typeof t.payload === 'string' ? JSON.parse(t.payload) : t.payload;
      caption = String(p?.caption || '').slice(0, 40);
    } catch {}
    taskMap[key].push({ ...t, caption, dateKey: key });
  }

  // Stats
  const stats = [
    { label: 'Published', value: tasks.filter(t => t.status === 'done').length, color: 'text-emerald-400' },
    { label: 'Pending', value: tasks.filter(t => t.status === 'pending').length, color: 'text-amber-400' },
    { label: 'Needs Media', value: tasks.filter(t => t.status === 'pending_media').length, color: 'text-rose-400' },
    { label: 'Failed', value: tasks.filter(t => t.status === 'failed').length, color: 'text-zinc-500' },
    { label: 'Total', value: tasks.length, color: 'text-white' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-rose-500/10 rounded-xl flex items-center justify-center border border-rose-500/20">
            <CalendarIcon className="w-5 h-5 text-rose-500" />
          </div>
          <div>
            <h2 className="text-lg font-black text-white">Publish Calendar</h2>
            <p className="text-xs text-zinc-500">Visual scheduling for auto-published content</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Stats chips */}
          {stats.map(s => (
            <div key={s.label} className="px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-xl flex items-center gap-2">
              <span className="text-[9px] font-black text-zinc-500 uppercase">{s.label}</span>
              <span className={cn("text-xs font-black", s.color)}>{s.value}</span>
            </div>
          ))}
          <button
            onClick={() => void loadTasks()}
            className="p-2 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-400 rounded-xl transition-all"
          >
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* Month Navigation */}
      <div className="flex items-center justify-between bg-[#111] border border-zinc-800/50 p-4 rounded-2xl">
        <button onClick={prevMonth} className="p-2 hover:bg-zinc-800 rounded-xl transition-colors">
          <ChevronLeft className="w-5 h-5 text-zinc-400" />
        </button>
        <h3 className="text-lg font-black text-white">
          {MONTHS[month]} {year}
          {month === now.getMonth() && year === now.getFullYear() && (
            <span className="ml-2 px-2 py-0.5 bg-rose-500/10 text-[9px] font-black rounded-full text-rose-500 align-middle">Today</span>
          )}
        </h3>
        <button onClick={nextMonth} className="p-2 hover:bg-zinc-800 rounded-xl transition-colors">
          <ChevronRight className="w-5 h-5 text-zinc-400" />
        </button>
      </div>

      {/* Calendar Grid */}
      <div className="bg-[#111] border border-zinc-800/50 rounded-[2rem] overflow-hidden">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-zinc-800/50">
          {DAYS.map(d => (
            <div key={d} className="p-3 text-[10px] font-black text-zinc-600 uppercase tracking-widest text-center">{d}</div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7">
          {/* Empty cells before first day */}
          {Array.from({ length: firstDay }).map((_, i) => (
            <div key={`empty-${i}`} className="min-h-[100px] border-r border-b border-zinc-800/30 bg-zinc-900/10" />
          ))}

          {/* Day cells */}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const dayTasks = taskMap[dateStr] || [];
            const isToday = dateStr === todayStr;
            const isPast = new Date(dateStr) < new Date(todayStr);

            return (
              <div
                key={day}
                className={cn(
                  "min-h-[100px] border-r border-b border-zinc-800/30 p-1.5 transition-colors",
                  isToday ? "bg-rose-500/5" : isPast ? "bg-zinc-900/20" : "bg-transparent",
                  "hover:bg-zinc-900/40 cursor-pointer"
                )}
              >
                <div className={cn(
                  "text-[10px] font-black mb-1 w-6 h-6 flex items-center justify-center rounded-full",
                  isToday ? "bg-rose-500 text-white" : "text-zinc-500"
                )}>
                  {day}
                </div>
                <div className="space-y-0.5">
                  {dayTasks.slice(0, 4).map((t: any) => (
                    <div
                      key={t.id}
                      onClick={(e) => { e.stopPropagation(); setSelectedTask(t); }}
                      className={cn(
                        "flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-bold truncate cursor-pointer hover:opacity-80",
                        t.status === 'done' ? "bg-emerald-500/10 text-emerald-400" :
                        t.status === 'pending_media' ? "bg-rose-500/10 text-rose-400" :
                        t.status === 'pending' ? "bg-amber-500/10 text-amber-400" :
                        t.status === 'scheduled' ? "bg-blue-500/10 text-blue-400" :
                        t.status === 'failed' ? "bg-zinc-800 text-zinc-500" :
                        "bg-zinc-800 text-zinc-400"
                      )}
                    >
                      <div className={cn("w-1 h-1 rounded-full flex-shrink-0", STATUS_COLORS[t.status] || 'bg-zinc-600')} />
                      <span className="truncate">{t.caption || t.id?.slice(0, 12)}</span>
                    </div>
                  ))}
                  {dayTasks.length > 4 && (
                    <div className="text-[8px] text-zinc-600 font-bold pl-1">+{dayTasks.length - 4} more</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected Task Detail Modal */}
      {selectedTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setSelectedTask(null)}>
          <div className="bg-[#1a1a1a] border border-zinc-800 rounded-2xl p-6 max-w-md w-full shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-black text-white text-sm">Task Detail</h4>
              <button onClick={() => setSelectedTask(null)} className="p-1 hover:bg-zinc-800 rounded-lg">
                <X className="w-4 h-4 text-zinc-500" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex justify-between">
                <span className="text-zinc-500">ID</span>
                <span className="text-zinc-300 font-mono">{selectedTask.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Status</span>
                <span className={cn(
                  "px-2 py-0.5 rounded text-[9px] font-black",
                  selectedTask.status === 'done' ? "bg-emerald-500/10 text-emerald-400" :
                  selectedTask.status === 'pending' ? "bg-amber-500/10 text-amber-400" :
                  selectedTask.status === 'pending_media' ? "bg-rose-500/10 text-rose-400" :
                  selectedTask.status === 'failed' ? "bg-zinc-800 text-zinc-500" :
                  "bg-blue-500/10 text-blue-400"
                )}>
                  {STATUS_LABELS[selectedTask.status] || selectedTask.status}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Platform</span>
                <span className="text-zinc-300">{selectedTask.platform || 'instagram'}</span>
              </div>
              {selectedTask.caption && (
                <div className="flex justify-between">
                  <span className="text-zinc-500">Caption</span>
                  <span className="text-zinc-300 text-right max-w-[250px]">{selectedTask.caption}</span>
                </div>
              )}
              {selectedTask.scheduled_at > 0 && (
                <div className="flex justify-between">
                  <span className="text-zinc-500">Scheduled</span>
                  <span className="text-zinc-300">{new Date(Number(selectedTask.scheduled_at)).toLocaleString()}</span>
                </div>
              )}
              {selectedTask.published_at && (
                <div className="flex justify-between">
                  <span className="text-zinc-500">Published</span>
                  <span className="text-zinc-300">{new Date(Number(selectedTask.published_at)).toLocaleString()}</span>
                </div>
              )}
              {selectedTask.error_reason && (
                <div className="flex justify-between">
                  <span className="text-zinc-500">Error</span>
                  <span className="text-rose-400 text-right max-w-[250px]">{selectedTask.error_reason}</span>
                </div>
              )}
              {selectedTask.platform_post_id && (
                <div className="flex justify-between">
                  <span className="text-zinc-500">Post ID</span>
                  <span className="text-zinc-300 font-mono">{selectedTask.platform_post_id}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
