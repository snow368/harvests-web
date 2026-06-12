import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { 
  MapPin, 
  Search, 
  Filter, 
  Mail, 
  Phone, 
  ExternalLink, 
  ChevronRight,
  TrendingUp,
  ShoppingBag,
  Clock,
  CheckCircle2,
  AlertCircle,
  Users,
  Plus,
  Zap,
  X,
  Copy,
  Terminal,
  Instagram,
  Flame,
  Brain,
  Sparkles,
  Loader2,
  Upload,
  FileText,
  Database,
  Monitor,
  Trash2,
  RefreshCw,
  Pause,
  Play,
  RotateCcw
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../lib/utils';
import { suggestOutreachStrategy } from '../lib/gemini';
import { toast } from 'sonner';
import { useCRM } from '../contexts/CRMContext';
import { useDropzone } from 'react-dropzone';
import Papa from 'papaparse';

const states = [
  'All Places', 
  'AZ', 'CA', 'FL', 'NY', 'TX', 'NV', 'WA', 'IL', 'GA', 'PA', // US States
  'UK', 'AU', 'CA_INTL', 'DE', 'FR', 'IT', 'ES', 'JP', 'KR', 'BR' // Countries
];

const COOP_PRODUCT_OPTIONS = [
  'cartridges',
  'inks',
  'machines',
  'power_supplies',
  'needles',
  'grips',
  'tips',
  'stencil',
  'aftercare',
  'furniture',
  'accessories'
];

const normText = (v: any) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

const isPlaceholderHandle = (h?: string): boolean => {
  const x = String(h || '').toLowerCase().trim();
  if (!x) return true;
  return x.startsWith('user_') || x.includes('shopify') || x.includes('unknown');
};

const normalizeInstagramUrl = (raw: string): string | null => {
  const x = String(raw || '').trim();
  if (!x) return null;
  if (x.toLowerCase().includes('instagram.com/')) {
    return x.startsWith('http') ? x : `https://${x}`;
  }
  if (!x.includes('http') && !x.includes('/')) {
    return `https://instagram.com/${x.replace(/^@/, '')}`;
  }
  return null;
};

const getInstagramInfo = (artist: any): { url: string; source: 'explicit' | 'handle' } | null => {
  const importedProvided = artist?.metadata?.importedInstagramProvided === true;
  const manualProvided = artist?.metadata?.manualInstagramProvided === true;
  if (!importedProvided && !manualProvided) return null;

  const explicitCandidates = [
    artist?.metadata?.manualInstagramUrl,
    artist?.metadata?.importedInstagramUrl,
    artist?.metadata?.instagram_url,
    artist?.metadata?.instagram
  ]
    .map((x: any) => String(x || '').trim())
    .filter(Boolean);

  let bestUrl: string | null = null;
  for (const c of explicitCandidates) {
    const normalized = normalizeInstagramUrl(c);
    if (normalized) {
      bestUrl = normalized;
      break;
    }
  }

  if (!bestUrl) {
    const handle = String(artist?.ig_handle || '').replace(/^@/, '').trim();
    if (handle && !isPlaceholderHandle(handle)) {
      bestUrl = `https://instagram.com/${handle}`;
      return { url: bestUrl, source: 'handle' };
    }
  }

  if (bestUrl) return { url: bestUrl, source: 'explicit' };
  return null;
};

const resolveInstagramUrl = (artist: any): string | null => getInstagramInfo(artist)?.url || null;

const isActiveDistributor = (artist: any): boolean => {
  if (!artist) return false;
  if (artist.metadata?.distributorExcluded === true) return false;
  return artist.metadata?.isDistributor === true || String(artist.metadata?.distributorStatus || '') === 'qualified';
};

export default function ShopOutreach({ onNavigate }: { onNavigate?: (tab: any) => void }) {
  const { 
    artists, 
    pagination,
    globalStats,
    importMetrics,
    deepScanTask,
    refreshDeepScanTask,
    pauseDeepScanTask,
    resumeDeepScanTask,
    retryFailedDeepScanTask,
    loadData,
    importCSV, 
    syncShopifySales, 
    bulkEnrichArtists, 
    clearAllData, 
    isScanning, 
    scanProgress,
    pinnedCount,
    persona, 
    mockMode,
    assignTaskToAccount,
    assignments,
    startAutomationSequence,
    updateArtist,
    deleteArtist,
    moveArtist
  } = useCRM();
  const safeImportMetrics = importMetrics || {
    rawRows: 0,
    validRows: 0,
    dedupedRows: 0,
    deepScanTargets: 0,
    enrichSuccess: 0,
    enrichFailed: 0,
    skipReasons: {
      missingName: 0,
      identical: 0,
      alreadyEnriched: 0,
      mappingError: 0
    }
  };
  const [selectedState, setSelectedState] = useState('All Places');
  const [search, setSearch] = useState('');
  const [activeStage, setActiveStage] = useState('all');
  const [accountTagFilter, setAccountTagFilter] = useState('all');
  const [sortMode, setSortMode] = useState<'priority' | 'engagement' | 'active_now' | 'tattoo_likelihood'>('priority');
  const [accountTag, setAccountTag] = useState('default');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [showScrape, setShowScrape] = useState(false);
  const [scrapeStateCode, setScrapeStateCode] = useState('');
  const [scrapeStateIsoCode, setScrapeStateIsoCode] = useState('');
  const [scrapeKeyword, setScrapeKeyword] = useState('Tattoo Shops');
  const [scrapeTaskId, setScrapeTaskId] = useState<string | null>(null);
  const [scrapeProgress, setScrapeProgress] = useState({ completed: 0, total: 0 });
  const [scrapeShopsSaved, setScrapeShopsSaved] = useState(0);
  const [scrapeStatus, setScrapeStatus] = useState('');
  const [scrapeResultsWarning, setScrapeResultsWarning] = useState('');
  const [scrapeLogs, setScrapeLogs] = useState<string[]>([]);
  const [scrapeCountry, setScrapeCountry] = useState('USA');
  const [scrapeStates, setScrapeStates] = useState<Array<{ name: string; isoCode: string }>>([]);  // 瀛樺偍褰撳墠鍥藉鐨勫窞/鐪佸垪琛?
  const [scrapeCustomCountry, setScrapeCustomCountry] = useState(''); 
  const [scrapeCities, setScrapeCities] = useState<string[]>([]);
  const [scrapeCityMeta, setScrapeCityMeta] = useState<{
    total: number;
    sources: Record<string, number>;
  } | null>(null);
  // 浠诲姟鎭㈠鐩稿叧
  const [manualTaskId, setManualTaskId] = useState('');           // 鎵嬪姩杈撳叆鐨勪换鍔D
  const [tasksList, setTasksList] = useState<Array<{id: string, status: string, completed: number, total: number}>>([]);
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [manualCitiesText, setManualCitiesText] = useState('');
  const [scrapeRows, setScrapeRows] = useState<any[]>([]);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const LAST_SCRAPE_TASK_KEY = 'inkflow:lastScrapeTaskId';

  const startScrape = async () => {
  // 1. 妫€鏌ュ浗瀹躲€佸窞
  if (!scrapeCustomCountry || !scrapeStateCode) {
    toast.error('璇峰厛閫夋嫨鍥藉銆佸窞');
    return;
  }
  // 2. 瑙ｆ瀽鎵嬪姩杈撳叆鐨勫煄甯傚垪琛?
  const cities = manualCitiesText
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);
  if (cities.length === 0) {
    toast.error('Please enter at least one city (one per line).');
    return;
  }

  // 3. 鍚姩鎶撳彇锛堝師鏈夐€昏緫锛屽彧鏄皢 scrapeCities 鏇挎崲涓?cities锛?
  setScrapeStatus('running');
  setScrapeProgress({ completed: 0, total: cities.length });

  try {
    const res = await fetch('/api/scrape/python', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        state: scrapeStateCode,
        cities: cities,                // 鈫?浣跨敤鎵嬪姩杈撳叆鐨勫煄甯?
        headless: false,
        keyword: scrapeKeyword,
        country: scrapeCustomCountry
      })
    });
    if (res.status === 409) {
      const conflict = await res.json().catch(() => ({}));
      const runningTaskId = String(conflict?.runningTaskId || '').trim();
      if (runningTaskId) {
        toast.info(`已有运行任务: ${runningTaskId}，已切换跟踪。`);
        await loadTask(runningTaskId);
        return;
      }
      throw new Error('conflict_running_task');
    }
    if (!res.ok) {
      const errPayload = await res.json().catch(() => ({}));
      throw new Error(String(errPayload?.error || `start_http_${res.status}`));
    }
    const data = await res.json();
    setScrapeTaskId(data.taskId);
    try { localStorage.setItem(LAST_SCRAPE_TASK_KEY, data.taskId); } catch {}
    setScrapeRows([]);
    startPolling(data.taskId);   // 纭繚浣犲凡鏈?startPolling 鍑芥暟
  } catch (err) {
    console.error('鍚姩鎶撳彇澶辫触:', err);
    toast.error('Failed to start scraping. Please check backend.');
    setScrapeStatus('error');
  }
};
// 鍔犺浇鎸囧畾浠诲姟鐨勭姸鎬侊紝鐢ㄤ簬鎭㈠杩涘害
const loadTask = async (taskId: string, options?: { silent?: boolean }) => {
  if (pollingIntervalRef.current) {
    clearInterval(pollingIntervalRef.current);
    pollingIntervalRef.current = null;
  }
  try {
    const res = await fetch(`/api/scrape/status/${taskId}`);
    if (!res.ok) {
      if (res.status === 404) {
        try { localStorage.removeItem(LAST_SCRAPE_TASK_KEY); } catch {}
        setScrapeTaskId(null);
        setSelectedTaskId('');
        if (!options?.silent) toast.error('Task not found. Cleared stale task id.');
        return;
      }
      throw new Error(`load_task_http_${res.status}`);
    }
    const data = await res.json();
    setScrapeTaskId(taskId);
    try { localStorage.setItem(LAST_SCRAPE_TASK_KEY, taskId); } catch {}
    setScrapeStatus(data.status);
    setScrapeShopsSaved(Number(data.shopsSaved || 0));
    setScrapeProgress({ completed: data.completed, total: data.total });
    setSelectedTaskId(taskId);
    try {
      const resultRes = await fetch(`/api/scrape/results/${taskId}?limit=100`);
      if (resultRes.ok) {
        const payload = await resultRes.json();
        if (payload?.warning) setScrapeResultsWarning(String(payload.warning));
        else setScrapeResultsWarning('');
        if (Array.isArray(payload.rows)) setScrapeRows(payload.rows);
      }
    } catch {
      setScrapeResultsWarning('results_unavailable');
    }
    if (data.status === 'running' || data.status === 'paused') {
      startPolling(taskId);
    }
    if (!options?.silent) {
      if (data.status === 'completed') {
        toast.success('Task completed. You can export now.');
      } else if (data.status === 'running') {
        toast.info('Task is running.');
      }
    }
  } catch (err) {
    console.error('鍔犺浇浠诲姟澶辫触:', err);
    if (!options?.silent) toast.error('Failed to load task.');
  }
};
useEffect(() => {
  fetch('/api/scrape/tasks')
    .then(res => res.json())
    .then(setTasksList)
    .catch(err => console.error('鑾峰彇浠诲姟鍒楄〃澶辫触:', err));
}, []);

useEffect(() => {
  try {
    const savedTaskId = localStorage.getItem(LAST_SCRAPE_TASK_KEY);
    if (savedTaskId) {
      void loadTask(savedTaskId, { silent: true });
    }
  } catch {}
}, []);

useEffect(() => {
  if (!scrapeTaskId) return;
  try { localStorage.setItem(LAST_SCRAPE_TASK_KEY, scrapeTaskId); } catch {}
}, [scrapeTaskId]);

    const startPolling = (taskId?: string) => {
  const activeTaskId = taskId || scrapeTaskId;
  if (!activeTaskId) return;

  if (pollingIntervalRef.current) {
    clearInterval(pollingIntervalRef.current);
    pollingIntervalRef.current = null;
  }

  pollingIntervalRef.current = setInterval(async () => {
    let statusData: any = null;
    try {
      const statusRes = await fetch(`/api/scrape/status/${activeTaskId}`);
      if (!statusRes.ok) throw new Error(`status_http_${statusRes.status}`);
      statusData = await statusRes.json();
      setScrapeProgress({ completed: statusData.completed, total: statusData.total });
      setScrapeShopsSaved(Number(statusData.shopsSaved || 0));
      setScrapeStatus(statusData.status);
      if (statusData.logs && Array.isArray(statusData.logs)) {
        setScrapeLogs(statusData.logs);
      }

      const resultRes = await fetch(`/api/scrape/results/${activeTaskId}?limit=100`);
      if (resultRes.ok) {
        const payload = await resultRes.json();
        if (payload?.warning) setScrapeResultsWarning(String(payload.warning));
        else setScrapeResultsWarning('');
        if (Array.isArray(payload.rows)) setScrapeRows(payload.rows);
      }
    } catch {
      setScrapeResultsWarning('backend_offline_or_results_unavailable');
      setScrapeStatus((prev) => prev || 'disconnected');
      return;
    }
    if (!statusData) return;
    if (statusData.status !== 'running' && statusData.status !== 'paused') {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      if (statusData.status === 'completed') toast.success('抓取完成');
    }
  }, 2000);
};

useEffect(() => {
  return () => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  };
}, []);
  const itemsPerPage = 50;

  // Redundant loadData call removed as CRMContext handles it
  const [isGeneratingStrategy, setIsGeneratingStrategy] = useState(false);
  const [strategy, setStrategy] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [importTab, setImportTab] = useState<'magic' | 'csv' | 'shopify'>('magic');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [retryReason, setRetryReason] = useState<string>('all');
  const lastAutoResumeAtRef = useRef<number>(0);

  const cleanDisplay = (text: any) => {
    if (typeof text !== 'string') return String(text || '');
    return text.replace(/\uFFFD/g, '');
  };

  const isPlaceholderGeo = (v: any) => {
    const x = String(v || '').trim().toLowerCase();
    if (!x) return true;
    return x === 'unknown' || x === 'n/a' || x === 'na' || x === 'null' || x === 'undefined';
  };

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    setUploadError(null);

    // Column Mapping Dictionary
    const headerMap: Record<string, string> = {
      'Shop Name': 'name', 'Business Name': 'name', 'Name': 'name', 'shopName': 'name', 'shop_name': 'name', 'Default Address Company': 'name', 'Title': 'name', 'title': 'name', 'Place Name': 'name',
      '搴楀悕': 'name', '鍚嶇О': 'name', '鍟嗗鍚嶇О': 'name', '鏍囬': 'name',
      'Instagram': 'ig_handle', 'IG': 'ig_handle', 'IG_Handle': 'ig_handle', 'igLink': 'ig_handle', 'ig_link': 'ig_handle', 'Instagram Handle': 'ig_handle', 'Instagram URL': 'ig_handle', 'instagram': 'ig_handle', 'Instagram_Handle': 'ig_handle',
      'Facebook': 'facebook_id', 'FB': 'facebook_id', 'Facebook URL': 'facebook_id', 'facebook': 'facebook_id',
      'Address': 'address', 'Street': 'address', 'Location_Address': 'address', 'Default Address Address1': 'address', 'Full Address': 'address', 'Formatted Address': 'address', 'address': 'address', 'Full_Address': 'address',
      '鍦板潃': 'address', '琛楅亾': 'address', '璇︾粏鍦板潃': 'address',
      'City': 'city', 'City_Name': 'city', 'Default Address City': 'city', 'city': 'city',
      'State': 'state', 'state': 'state', 'Province': 'state', 'Province Code': 'state', 'Default Address Province Code': 'state',
      '鍩庡競': 'city', '鐪佷唤': 'state', '宸': 'state',
      'Phone': 'phone', 'Phone_Number': 'phone', 'Contact_Phone': 'phone', 'Default Address Phone': 'phone', 'phone': 'phone', 'Phone Number': 'phone',
      '鐢佃瘽': 'phone', '鎵嬫満': 'phone', '鑱旂郴鐢佃瘽': 'phone',
      'Website': 'website', 'Web_URL': 'website', 'Site': 'website', 'website': 'website', 'link': 'website', 'URL': 'website',
      '缃戠珯': 'website', '缃戝潃': 'website',
      'Email': 'email', 'Contact_Email': 'email', 'email': 'email', 'E-mail': 'email',
      '閭': 'email', '鐢靛瓙閭欢': 'email',
      'Reviews': 'rating', 'Rating': 'rating', 'mapsRating': 'rating', 'Avg Rating': 'rating', 'rating': 'rating', 'Rating_Value': 'rating',
      '璇勫垎': 'rating', '鏄熺骇': 'rating',
      'Followers': 'followers', 'Follower Count': 'followers', 'followers': 'followers', 'followers_count': 'followers',
      '绮変笣': 'followers', '绮变笣鏁': 'followers',
      'Country': 'country', 'Nation': 'country', 'country': 'country', 'Default Address Country': 'country',
      '鍥藉': 'country', '鍦板尯': 'country',
      'Place ID': 'place_id', 'place_id': 'place_id', 'CID': 'cid', 'cid': 'cid'
    };

    if (mockMode) {
      toast.info('Mock Mode: Simulating CSV processing...');
      setTimeout(() => {
        const mockData = [
          { name: "Ink Masters", rating: "4.8", ig_handle: "@inkmasters", address: "123 Tattoo St, Phoenix, AZ" },
          { name: "Vivid Skin", rating: "4.5", ig_handle: "@vividskin", address: "456 Art Ave, Miami, FL" },
          { name: "Eternal Ink", rating: "4.9", ig_handle: "@eternalink", address: "789 Needle Rd, Austin, TX" },
          { name: "Black Rose", rating: "4.7", ig_handle: "@blackrose", address: "101 Thorn Ln, Los Angeles, CA" },
          { name: "Urban Canvas", rating: "4.6", ig_handle: "@urbancanvas", address: "202 City Blvd, New York, NY" },
          { name: "Desert Soul", rating: "4.4", ig_handle: "@desertsoul", address: "303 Sand Dr, Las Vegas, NV" },
          { name: "Iron & Ink", rating: "4.8", ig_handle: "@ironink", address: "404 Metal St, Phoenix, AZ" },
          { name: "Sacred Geometry", rating: "5.0", ig_handle: "@sacredgeo", address: "505 Pattern Rd, Miami, FL" },
          { name: "Old School", rating: "4.3", ig_handle: "@oldschool", address: "606 Retro Way, Austin, TX" },
          { name: "Neon Dream", rating: "4.9", ig_handle: "@neondream", address: "707 Glow Ave, Los Angeles, CA" }
        ];
        importCSV(mockData, selectedState, accountTag);
        setShowImport(false);
      }, 2000);
      return;
    }

    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result as string;
      
      // Check for the Unicode Replacement Character (U+FFFD) which indicates decoding failure
      if (text.includes('\uFFFD')) {
        console.warn("UTF-8 decoding failed (found replacement characters). Retrying with Windows-1252...");
        const reader2 = new FileReader();
        reader2.onload = (e2) => {
          parseCSV(e2.target.result as string);
        };
        reader2.readAsText(file, 'windows-1252');
      } else {
        parseCSV(text);
      }
    };

    const parseCSV = (csvText: string) => {
      if (importTab === 'shopify') {
        Papa.parse(csvText, {
          header: true,
          skipEmptyLines: true,
          complete: (results) => {
            syncShopifySales(results.data, accountTag);
            setShowImport(false);
          },
          error: (err) => {
            setUploadError(`Failed to parse Shopify CSV: ${err.message}`);
          }
        });
        return;
      }

      Papa.parse(csvText, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: 'greedy',
        transformHeader: (h) => h.trim(),
        complete: (results) => {
          const rawData = results.data as any[];
          const mappedData = rawData.map(row => {
            const normalized: any = { metadata: {} };
            
            Object.keys(row).forEach(key => {
              const trimmedKey = key.trim();
              let value = row[key];
              
              // Clean up strings from any remaining garbage characters
              if (typeof value === 'string') {
                value = value.trim().replace(/\uFFFD/g, '');
              }
              
              const mappedField = headerMap[trimmedKey];

              if (mappedField) {
                normalized[mappedField] = value;
              } else {
                normalized.metadata[trimmedKey] = value;
              }
            });

            // Fallback for Name if not directly mapped
            if (!normalized.name) {
              const firstName = row['First Name'] || row['first_name'] || '';
              const lastName = row['Last Name'] || row['last_name'] || '';
              if (firstName || lastName) {
                normalized.name = `${firstName} ${lastName}`.trim();
              } else if (row['Default Address Company']) {
                normalized.name = row['Default Address Company'];
              }
            }

            // Data Cleaning for IG Handle
            if (normalized.ig_handle) {
              // Extract handle from URL if necessary
              if (normalized.ig_handle.includes('instagram.com/')) {
                normalized.ig_handle = normalized.ig_handle.split('instagram.com/').pop()?.split('/')[0] || normalized.ig_handle;
              }
              // Ensure @ prefix
              if (!normalized.ig_handle.startsWith('@')) {
                normalized.ig_handle = `@${normalized.ig_handle}`;
              }
              // Remove any non-standard characters from handle
              normalized.ig_handle = normalized.ig_handle.replace(/[^\w@.]/g, '');
            }

            return normalized;
          });

          // Validation: Allow importing if at least Name is present. 
          // Contact info is preferred but not strictly required for initial import
          const validData = mappedData.filter(d => d.name);
          
          if (validData.length > 0) {
            importCSV(
              validData,
              selectedState === 'All Places' ? undefined : selectedState,
              accountTag,
              { rawRows: mappedData.length, missingNameRows: Math.max(0, mappedData.length - validData.length) }
            );
            setShowImport(false);
            if (validData.length < mappedData.length) {
              toast.warning(`Imported ${validData.length} leads. Some rows were skipped due to missing Name.`);
            }
          } else {
            const errMsg = "Error: Could not find 'Name' (or Title/Shop Name) in your CSV.";
            setUploadError(errMsg);
            toast.error(errMsg);
          }
        },
        error: (error) => {
          const errMsg = `Error parsing CSV: ${error.message}`;
          setUploadError(errMsg);
          toast.error(errMsg);
        }
      });
    };

    reader.readAsText(file, 'UTF-8');
  }, [importCSV, selectedState, mockMode]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop,
    accept: {
      'text/csv': ['.csv'],
      'application/vnd.ms-excel': ['.csv']
    },
    multiple: false
  } as any);

  const filteredShops = useMemo(() => {
    const currentHour = new Date().getHours();
    const hourDistance = (a: number, b: number) => {
      const raw = Math.abs(a - b);
      return Math.min(raw, 24 - raw);
    };
    const isActiveNow = (hours?: number[]) => {
      if (!hours || hours.length === 0) return false;
      return hours.some((h) => Number.isFinite(h) && hourDistance(currentHour, Number(h)) <= 1);
    };

    return artists
      .filter(artist => {
        if (isActiveDistributor(artist)) return false;
        const matchesStage = activeStage === 'all' ? true : artist.stage === activeStage;
        const matchesLocation = selectedState === 'All Places' || 
                               artist.location === selectedState ||
                               artist.state === selectedState ||
                               artist.country === selectedState ||
                               (typeof artist.address === 'string' && artist.address.includes(selectedState));
        const matchesSearch = (artist.username?.toLowerCase() || '').includes(search.toLowerCase()) || 
                             (artist.fullName?.toLowerCase() || '').includes(search.toLowerCase()) ||
                             (artist.shopName?.toLowerCase() || '').includes(search.toLowerCase());
        const matchesAccountTag = accountTagFilter === 'all' || artist.account_tag === accountTagFilter;
        
        return matchesStage && matchesLocation && matchesSearch && matchesAccountTag;
      })
      .sort((a, b) => {
        if (sortMode === 'engagement') {
          return (b.socialSignals?.engagementRate || 0) - (a.socialSignals?.engagementRate || 0);
        }
        if (sortMode === 'active_now') {
          const aNow = isActiveNow(a.socialSignals?.postingHours) ? 1 : 0;
          const bNow = isActiveNow(b.socialSignals?.postingHours) ? 1 : 0;
          if (bNow !== aNow) return bNow - aNow;
          return (b.socialSignals?.postsPerWeek || 0) - (a.socialSignals?.postsPerWeek || 0);
        }
        if (sortMode === 'tattoo_likelihood') {
          return (b.socialSignals?.tattooLikelihood || 0) - (a.socialSignals?.tattooLikelihood || 0);
        }

        let aScore = (a.heatScore || 0) + (a.similarityScore || 0);
        let bScore = (b.heatScore || 0) + (b.similarityScore || 0);
        
        // Massive boost for "Just Followed Back"
        if (a.hasFollowedBack) aScore += 100;
        if (b.hasFollowedBack) bScore += 100;
        
        return bScore - aScore;
      });
  }, [artists, selectedState, search, accountTagFilter, sortMode, activeStage]);

  const paginatedShops = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredShops.slice(start, start + itemsPerPage);
  }, [filteredShops, currentPage]);

  const totalPages = Math.ceil(filteredShops.length / itemsPerPage);

  const directSalesCandidates = useMemo(() => {
    const currentHour = new Date().getHours();
    const distance = (a: number, b: number) => {
      const raw = Math.abs(a - b);
      return Math.min(raw, 24 - raw);
    };
    return artists
      .filter((artist) => {
        if (isActiveDistributor(artist)) return false;
        const haystack = `${artist.shopName || ''} ${artist.fullName || ''} ${artist.username || ''}`.toLowerCase();
        const matchesLocation = selectedState === 'All Places' ||
          artist.location === selectedState ||
          artist.state === selectedState ||
          artist.country === selectedState ||
          (typeof artist.address === 'string' && artist.address.includes(selectedState));
        const matchesSearch = haystack.includes(search.toLowerCase());
        const matchesAccountTag = accountTagFilter === 'all' || artist.account_tag === accountTagFilter;
        return matchesLocation && matchesSearch && matchesAccountTag;
      })
      .map((artist) => {
        const isDistributor = artist.metadata?.isDistributor === true || String(artist.metadata?.distributorStatus || '') === 'qualified';
        const activeNow = (artist.socialSignals?.postingHours || []).some((h) => Number.isFinite(h) && distance(Number(h), currentHour) <= 1);
        const contactCount = [
          artist.ig_handle,
          artist.email,
          artist.phone,
          artist.facebookId
        ].filter(Boolean).length;
        const score =
          (artist.stage === 'customers' ? 30 : artist.stage === 'engaged' ? 18 : 8) +
          Math.min(20, (artist.socialSignals?.engagementRate || 0) * 2) +
          Math.min(12, (artist.socialSignals?.postsPerWeek || 0) * 2) +
          Math.min(12, contactCount * 3) +
          (activeNow ? 10 : 0) +
          (artist.hasFollowedBack ? 8 : 0) +
          (isDistributor ? -25 : 0);
        return {
          artist,
          directScore: Math.round(score),
          activeNow,
          contactCount
        };
      })
      .filter((x) => x.directScore > 20)
      .sort((a, b) => b.directScore - a.directScore)
      .slice(0, 40);
  }, [artists, selectedState, search, accountTagFilter]);

  const distributorCandidates = useMemo(() => {
    const distributorKeywords = [
      'supply',
      'supplier',
      'wholesale',
      'distribution',
      'distributor',
      'ink supplier',
      'tattoo supply'
    ];
    return artists
      .filter((artist) => {
        if (artist.metadata?.distributorExcluded === true) return false;
        const haystack = `${artist.shopName || ''} ${artist.fullName || ''} ${artist.website || ''}`.toLowerCase();
        const keywordHit = distributorKeywords.some((k) => haystack.includes(k));
        const followingHit = Array.isArray(artist.metadata?.followingDistributors) && artist.metadata.followingDistributors.length > 0;
        const flagged = artist.metadata?.isDistributor === true;
        const status = String(artist.metadata?.distributorStatus || 'new');
        // Stricter rule to reduce false positives:
        // 1) keyword hit, OR
        // 2) has following evidence, OR
        // 3) manually flagged + qualified
        return keywordHit || followingHit || (flagged && status === 'qualified');
      })
      .map((artist) => {
        const distributorHandle = normText(artist.ig_handle || artist.username || '');
        const distributorName = normText(artist.shopName || artist.fullName || '');
        const distributorWebsite = normText(artist.website || '');
        const connectorCandidates = artists
          .filter((a) => a.id !== artist.id)
          .map((a) => {
            const stageBase = a.stage === 'customers' ? 36 : a.stage === 'engaged' ? 24 : 8;
            const relationScore = (a.replyCount || 0) * 3 + (a.likeCount || 0) + (a.hasFollowedBack ? 12 : 0);
            const orderScore = Math.min(18, (a.orderCount || 0) * 3);
            const sameRegion =
              (a.state && artist.state && a.state === artist.state) ||
              (a.city && artist.city && a.city === artist.city) ||
              (a.country && artist.country && a.country === artist.country);
            const regionScore = sameRegion ? 12 : 0;

            const follows = Array.isArray(a.metadata?.followingDistributors) ? a.metadata.followingDistributors : [];
            const followsHit = follows.some((x: any) => {
              const nx = normText(x);
              return Boolean(nx) && (
                (distributorHandle && nx.includes(distributorHandle)) ||
                (distributorName && nx.includes(distributorName)) ||
                (distributorWebsite && nx.includes(distributorWebsite))
              );
            });
            const referralIds = Array.isArray(a.metadata?.referralDistributorIds) ? a.metadata.referralDistributorIds : [];
            const explicitHit = referralIds.includes(artist.id) || followsHit;
            const explicitScore = explicitHit ? 40 : 0;

            const connectorScore = stageBase + relationScore + orderScore + regionScore + explicitScore;
            return { artist: a, connectorScore, explicitHit };
          })
          .filter((x) => x.connectorScore >= 35)
          .sort((a, b) => b.connectorScore - a.connectorScore)
          .slice(0, 3);

        const sourceCount = Array.isArray(artist.metadata?.followingDistributors) ? artist.metadata.followingDistributors.length : 0;
        const brandPartners = Array.isArray(artist.metadata?.brandPartners)
          ? artist.metadata.brandPartners.length
          : Number(artist.metadata?.brandPartnerCount || artist.metadata?.brand_count || 0);
        const followers = Number(artist.followers || 0);
        const keywordHit = distributorKeywords.some((k) =>
          `${artist.shopName || ''} ${artist.fullName || ''} ${artist.website || ''}`.toLowerCase().includes(k)
        );
        const keywordWeight = keywordHit ? 20 : 0;
        const status = String(artist.metadata?.distributorStatus || 'new');
        const isManualFlag = artist.metadata?.isDistributor === true;
        const hasFollowingEvidence = sourceCount > 0;
        const reasonTags = [
          ...(keywordHit ? ['keyword'] : []),
          ...(hasFollowingEvidence ? ['artist_referral'] : []),
          ...(isManualFlag ? ['manual_flag'] : []),
          ...(status === 'qualified' ? ['qualified'] : [])
        ];
        const distributorScore =
          30 +
          Math.min(30, sourceCount * 6) +
          Math.min(25, Math.log10(Math.max(10, followers)) * 8) +
          Math.min(20, brandPartners * 4) +
          keywordWeight +
          (artist.website ? 8 : 0) +
          (artist.email ? 8 : 0) +
          (status === 'qualified' ? 12 : 0);
        let tier: 'S' | 'A' | 'B' | 'C' = 'C';
        if (followers >= 200000 || brandPartners >= 15) tier = 'S';
        else if (followers >= 50000 || brandPartners >= 8) tier = 'A';
        else if (followers >= 10000 || brandPartners >= 3) tier = 'B';

        const priority =
          tier === 'S' ? 'P0' :
          tier === 'A' ? 'P1' :
          tier === 'B' ? 'P2' : 'P3';

        return {
          artist,
          sourceCount,
          followers,
          brandPartners,
          connectors: connectorCandidates,
          reasonTags,
          status,
          tier,
          priority,
          distributorScore: Math.round(distributorScore)
        };
      })
      .sort((a, b) => {
        const pr = { P0: 4, P1: 3, P2: 2, P3: 1 };
        const pa = pr[a.priority as keyof typeof pr] || 0;
        const pb = pr[b.priority as keyof typeof pr] || 0;
        if (pb !== pa) return pb - pa;
        return b.distributorScore - a.distributorScore;
      });
  }, [artists]);

  const REORDER_STALE_DAYS = 60;

  const distributorLifecycleBuckets = useMemo(() => {
    const base = distributorCandidates.map(({ artist, priority, tier, distributorScore }) => {
      const lifecycle = String(artist.metadata?.distributorLifecycle || '');
      const sampleStatus = String(artist.metadata?.sampleStatus || '');
      const orderCount = Number(artist.orderCount || 0);
      const lastOrderAt = artist.lastOrderDate ? new Date(artist.lastOrderDate).getTime() : 0;
      const daysSinceLastOrder = lastOrderAt ? Math.floor((Date.now() - lastOrderAt) / (1000 * 60 * 60 * 24)) : null;

      let bucket: 'sample_sent' | 'bad_feedback' | 'positive_no_order' | 'one_order_stalled' | 'long_no_order' | 'other' = 'other';
      if (lifecycle === 'sample_sent' || sampleStatus === 'sent') bucket = 'sample_sent';
      if (lifecycle === 'bad_feedback' || sampleStatus === 'negative') bucket = 'bad_feedback';
      if (lifecycle === 'positive_no_order' || (sampleStatus === 'positive' && orderCount === 0)) bucket = 'positive_no_order';
      if (
        lifecycle === 'one_order_stalled' ||
        (orderCount === 1 && (daysSinceLastOrder === null || daysSinceLastOrder >= 21))
      ) {
        bucket = 'one_order_stalled';
      }
      if (
        lifecycle === 'long_no_order' ||
        (orderCount >= 1 && daysSinceLastOrder !== null && daysSinceLastOrder >= REORDER_STALE_DAYS)
      ) {
        bucket = 'long_no_order';
      }

      return { artist, priority, tier, distributorScore, bucket, orderCount, daysSinceLastOrder };
    });

    return {
      sample_sent: base.filter((x) => x.bucket === 'sample_sent'),
      bad_feedback: base.filter((x) => x.bucket === 'bad_feedback'),
      positive_no_order: base.filter((x) => x.bucket === 'positive_no_order'),
      one_order_stalled: base.filter((x) => x.bucket === 'one_order_stalled'),
      long_no_order: base.filter((x) => x.bucket === 'long_no_order')
    };
  }, [distributorCandidates, REORDER_STALE_DAYS]);

  const distributorByCountry = useMemo(() => {
    const US_STATE_CODES = new Set([
      'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
      'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
      'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'
    ]);
    const US_STATE_NAMES = new Set([
      'ALABAMA','ALASKA','ARIZONA','ARKANSAS','CALIFORNIA','COLORADO','CONNECTICUT','DELAWARE','FLORIDA','GEORGIA',
      'HAWAII','IDAHO','ILLINOIS','INDIANA','IOWA','KANSAS','KENTUCKY','LOUISIANA','MAINE','MARYLAND',
      'MASSACHUSETTS','MICHIGAN','MINNESOTA','MISSISSIPPI','MISSOURI','MONTANA','NEBRASKA','NEVADA','NEW HAMPSHIRE',
      'NEW JERSEY','NEW MEXICO','NEW YORK','NORTH CAROLINA','NORTH DAKOTA','OHIO','OKLAHOMA','OREGON','PENNSYLVANIA',
      'RHODE ISLAND','SOUTH CAROLINA','SOUTH DAKOTA','TENNESSEE','TEXAS','UTAH','VERMONT','VIRGINIA','WASHINGTON',
      'WEST VIRGINIA','WISCONSIN','WYOMING','DISTRICT OF COLUMBIA'
    ]);
    const COUNTRY_CODE_TO_NAME: Record<string, string> = {
      US: 'USA',
      UK: 'United Kingdom',
      GB: 'United Kingdom',
      CA: 'Canada',
      AU: 'Australia',
      NZ: 'New Zealand',
      DE: 'Germany',
      FR: 'France',
      IT: 'Italy',
      ES: 'Spain',
      PT: 'Portugal',
      NL: 'Netherlands',
      BE: 'Belgium',
      CH: 'Switzerland',
      SE: 'Sweden',
      NO: 'Norway',
      DK: 'Denmark',
      FI: 'Finland',
      IE: 'Ireland',
      AT: 'Austria',
      JP: 'Japan',
      KR: 'South Korea',
      CN: 'China',
      TW: 'Taiwan',
      HK: 'Hong Kong',
      SG: 'Singapore',
      MY: 'Malaysia',
      TH: 'Thailand',
      VN: 'Vietnam',
      ID: 'Indonesia',
      PH: 'Philippines',
      IN: 'India',
      MX: 'Mexico',
      BR: 'Brazil',
      AR: 'Argentina',
      CL: 'Chile',
      CO: 'Colombia',
      TR: 'Turkey',
      AE: 'United Arab Emirates',
      SA: 'Saudi Arabia',
      IL: 'Israel',
      ZA: 'South Africa'
    };
    const normalizeCountryLabel = (raw: string) => {
      const v = String(raw || '').trim();
      const upper = v.toUpperCase();
      if (!v) return 'UNSET';
      const isUsToken = (x: string) =>
        x === 'USA' ||
        x === 'US' ||
        x === 'U.S.A' ||
        x === 'UNITED STATES' ||
        x === 'UNITED STATES OF AMERICA';

      // 1) Explicit country code/name first (avoid DE/IN/CA being mistaken as US states)
      if (COUNTRY_CODE_TO_NAME[upper]) return COUNTRY_CODE_TO_NAME[upper];
      if (isUsToken(upper) || upper.includes('UNITED STATES')) return 'USA';
      if (/^US[-_\s]*[A-Z]{2}$/.test(upper)) return 'USA';

      // 2) Parse composite values, prefer last token as country
      const tokenized = upper.split(/[,/|]+/).map((x) => x.trim()).filter(Boolean);
      const lastToken = tokenized[tokenized.length - 1] || '';
      if (COUNTRY_CODE_TO_NAME[lastToken]) return COUNTRY_CODE_TO_NAME[lastToken];
      if (isUsToken(lastToken)) return 'USA';
      if (tokenized.some((t) => isUsToken(t))) return 'USA';

      // 3) If it's exactly a US state code/name, map to USA
      if (US_STATE_CODES.has(upper) || US_STATE_NAMES.has(upper)) return 'USA';
      if (lastToken && (US_STATE_CODES.has(lastToken) || US_STATE_NAMES.has(lastToken))) return 'USA';

      return v;
    };

    const resolveCountryKey = (artist: any) => {
      // 1) Manual override from distributor board takes highest priority
      const geoDisplay = String(artist.metadata?.distributorGeoDisplay || '').trim();
      if (!isPlaceholderGeo(geoDisplay)) {
        const segments = geoDisplay.split(',').map((s) => s.trim()).filter(Boolean);
        const last = String(segments[segments.length - 1] || '');
        if (last) return normalizeCountryLabel(last);
      }

      // 2) Fallback to artist country
      const rawCountry = String(artist.country || '').trim();
      if (!isPlaceholderGeo(rawCountry)) {
        return normalizeCountryLabel(rawCountry);
      }

      // 3) Last fallback: shop location text
      const locationText = String(artist.location || '').trim();
      if (!isPlaceholderGeo(locationText)) {
        const segments = locationText.split(',').map((s) => s.trim()).filter(Boolean);
        const last = String(segments[segments.length - 1] || '');
        if (last) return normalizeCountryLabel(last);
      }

      return 'UNSET';
    };

    const stats: Record<string, number> = {};
    distributorCandidates.forEach(({ artist }) => {
      const key = resolveCountryKey(artist);
      stats[key] = (stats[key] || 0) + 1;
    });
    return Object.entries(stats).sort((a, b) => b[1] - a[1]);
  }, [distributorCandidates]);

  const markDistributorLifecycle = async (
    artistId: string,
    lifecycle: 'sample_sent' | 'bad_feedback' | 'positive_no_order' | 'one_order_stalled' | 'long_no_order',
    extra: Record<string, any> = {}
  ) => {
    const artist = artists.find((a) => a.id === artistId);
    if (!artist) return;
    await updateArtist(artistId, {
      metadata: {
        ...(artist.metadata || {}),
        distributorLifecycle: lifecycle,
        lifecycleUpdatedAt: new Date().toISOString(),
        ...extra
      }
    });
  };

  const referralReadyArtists = useMemo(() => {
    return artists
      .filter((artist) => {
        const stageScore = artist.stage === 'customers' ? 3 : artist.stage === 'engaged' ? 2 : 0;
        const interactionScore = (artist.replyCount || 0) + (artist.likeCount || 0) + (artist.hasFollowedBack ? 2 : 0);
        return stageScore > 0 && interactionScore >= 2;
      })
      .map((artist) => {
        const trustScore =
          (artist.stage === 'customers' ? 40 : 20) +
          Math.min(20, (artist.replyCount || 0) * 3) +
          Math.min(15, (artist.likeCount || 0) * 1.5) +
          (artist.hasFollowedBack ? 15 : 0) +
          Math.min(10, (artist.orderCount || 0) * 2);
        return { artist, trustScore };
      })
      .sort((a, b) => b.trustScore - a.trustScore)
      .slice(0, 20);
  }, [artists]);

  const buildReferralScript = (name: string, region: string, discount: string) => {
    return `Hey ${name}, appreciate your support. We're expanding in ${region} and looking for solid local tattoo distributors.\nIf you can intro 1-2 trusted distributor contacts, we can offer your clients a ${discount} partner deal.\nIf useful, just drop their Instagram/WhatsApp and I'll handle the follow-up professionally.`;
  };

  const handleAddManualDistributor = async () => {
    const name = window.prompt('Distributor name');
    if (!name || !name.trim()) return;
    const igInput = window.prompt('Instagram URL/handle (optional)', '') || '';
    const igUrl = normalizeInstagramUrl(igInput.trim());
    const igHandle = igUrl ? igUrl.split('instagram.com/')[1]?.split('/')[0]?.split('?')[0] : '';
    const city = (window.prompt('City (optional)', '') || '').trim();
    const state = (window.prompt('State/Region (optional)', '') || '').trim();
    const country = (window.prompt('Country (optional)', 'USA') || 'USA').trim();
    const website = (window.prompt('Website (optional)', '') || '').trim();
    const phone = (window.prompt('Phone (optional)', '') || '').trim();
    const email = (window.prompt('Email (optional)', '') || '').trim();

    const address = [city, state, country].filter(Boolean).join(', ');
    await importCSV([{
      name: name.trim(),
      ig_handle: igHandle || '',
      city,
      state,
      country,
      address,
      website,
      phone,
      email,
      metadata: {
        isDistributor: true,
        distributorStatus: 'qualified',
        ingestSource: 'manual_distributor',
        manualDistributorEntry: true,
        ...(igUrl ? { manualInstagramProvided: true, manualInstagramUrl: igUrl } : {})
      }
    }], selectedState === 'All Places' ? undefined : selectedState, accountTag, { rawRows: 1, missingNameRows: 0 });

    toast.success('Manual distributor added.');
  };

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedState, search, accountTagFilter, sortMode]);

  const handleGenerateStrategy = async () => {
    setIsGeneratingStrategy(true);
    setStrategy(null);
    
    try {
      const result = await suggestOutreachStrategy(selectedState, filteredShops);
      setStrategy(result);
    } catch (error) {
      console.error('Strategy generation failed:', error);
    } finally {
      setIsGeneratingStrategy(false);
    }
  };

  const handleMagicPaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        toast.error("Clipboard is empty!");
        return;
      }

      // Simple parser for the scraper output
      const lines = text.split('\n').filter(l => l.includes('|'));
      if (lines.length === 0) {
        toast.error("No valid shop data found in clipboard. Use the scraper script first!");
        return;
      }

      const newShops = lines.map((line, i) => {
        const [name, ratingPart, address, website] = line.split('|').map(s => s.trim());
        const rating = ratingPart?.replace('Rating:', '').trim() || 'N/A';
        
        return {
          shopName: name,
          mapsRating: rating,
          address: address || `${selectedState}, USA`,
          location: selectedState,
          igLink: website || `https://instagram.com/${name.toLowerCase().replace(/\s+/g, '_')}`
        };
      });

      await importCSV(newShops, selectedState);
      setShowImport(false);
    } catch (err) {
      toast.error("Please allow clipboard access or paste manually.");
    }
  };

  const handleRefreshDeepScan = async () => {
    try {
      const status = await refreshDeepScanTask();
      if (!status) {
        toast.info('No active deep scan task found.');
        return;
      }
      toast.success(`Task ${status.id} is ${status.status}.`);
    } catch (e) {
      toast.error('Failed to refresh deep scan status.');
    }
  };

  const handlePauseDeepScan = async () => {
    try {
      const status = await pauseDeepScanTask();
      if (!status) {
        toast.info('No task to pause.');
        return;
      }
      toast.success(`Task paused: ${status.id}`);
    } catch {
      toast.error('Failed to pause task.');
    }
  };

  const handleResumeDeepScan = async () => {
    try {
      const status = await resumeDeepScanTask();
      if (!status) {
        toast.info('No paused task to resume.');
        return;
      }
      toast.success(`Task resumed: ${status.id}`);
      if (!isScanning) {
        await bulkEnrichArtists();
      }
    } catch {
      toast.error('Failed to resume task.');
    }
  };

  const handleRetryFailedDeepScan = async () => {
    try {
      const reason = retryReason === 'all' ? undefined : retryReason;
      const status = await retryFailedDeepScanTask(undefined, reason);
      if (!status) {
        toast.info('No failed items to retry.');
        return;
      }
      toast.success(`Retry queued${reason ? ` for ${reason}` : ''}. Failed backlog now: ${status.failed}`);
      if (!isScanning) {
        await bulkEnrichArtists();
      }
    } catch {
      toast.error('Failed to retry failed items.');
    }
  };

  const handleContinueDeepScan = async () => {
    try {
      if (isScanning) {
        toast.info('Deep Scan worker is already running.');
        return;
      }
      toast.info('Restarting Deep Scan worker...');
      await bulkEnrichArtists();
    } catch {
      toast.error('Failed to continue deep scan worker.');
    }
  };

  const handleExportFailedCsv = async () => {
    if (!deepScanTask?.id) return;
    try {
      const resp = await fetch(`/api/deep-scan/failed/${deepScanTask.id}`);
      if (!resp.ok) throw new Error('Failed to fetch failed items');
      const payload = await resp.json();
      const items = Array.isArray(payload?.items) ? payload.items : [];
      if (items.length === 0) {
        toast.info('No failed items to export.');
        return;
      }
      const csv = Papa.unparse(items);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `deep_scan_failed_${deepScanTask.id}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success(`Exported ${items.length} failed rows.`);
    } catch {
      toast.error('Failed to export failed CSV.');
    }
  };

  useEffect(() => {
    if (!deepScanTask) return;
    const stalled =
      deepScanTask.status === 'running' &&
      deepScanTask.pending > 0 &&
      !isScanning;
    if (!stalled) return;

    const now = Date.now();
    if (now - lastAutoResumeAtRef.current < 30000) return;
    lastAutoResumeAtRef.current = now;

    toast.info(`Deep Scan worker paused unexpectedly. Auto-resuming task ${deepScanTask.id}...`);
    void bulkEnrichArtists();
  }, [deepScanTask, isScanning, bulkEnrichArtists]);

  return (
    <>
    <div className="space-y-8">
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        {[
          { label: 'Raw Rows', value: safeImportMetrics.rawRows, tone: 'text-zinc-300 border-zinc-800' },
          { label: 'Valid Rows', value: safeImportMetrics.validRows, tone: 'text-emerald-300 border-emerald-500/20' },
          { label: 'Deduped', value: safeImportMetrics.dedupedRows, tone: 'text-amber-300 border-amber-500/20' },
          { label: 'DeepScan', value: safeImportMetrics.deepScanTargets, tone: 'text-rose-300 border-rose-500/20' },
          { label: 'Enrich OK', value: safeImportMetrics.enrichSuccess, tone: 'text-blue-300 border-blue-500/20' },
          { label: 'Enrich Fail', value: safeImportMetrics.enrichFailed, tone: 'text-red-300 border-red-500/20' },
          { label: 'No Name', value: safeImportMetrics.skipReasons.missingName, tone: 'text-zinc-400 border-zinc-800' },
          { label: 'Identical', value: safeImportMetrics.skipReasons.identical, tone: 'text-zinc-400 border-zinc-800' }
        ].map((item) => (
          <div key={item.label} className={`bg-zinc-900/40 border rounded-xl p-3 ${item.tone}`}>
            <p className="text-[9px] font-black uppercase tracking-widest opacity-80">{item.label}</p>
            <p className="text-sm font-black mt-1">{Number(item.value || 0).toLocaleString()}</p>
          </div>
        ))}
      </div>
      <div className="text-[10px] font-bold text-zinc-500 px-1">
        Skips: already enriched {Number(safeImportMetrics.skipReasons.alreadyEnriched || 0).toLocaleString()} | mapping errors {Number(safeImportMetrics.skipReasons.mappingError || 0).toLocaleString()}
      </div>

      {deepScanTask && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-4 space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <div className="space-y-1">
              <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Deep Scan Task</p>
              <p className="text-xs font-bold text-zinc-200">taskId: <span className="text-rose-400">{deepScanTask.id}</span></p>
              <p className="text-[11px] text-zinc-400">
                status <span className="text-zinc-200 font-bold">{deepScanTask.status}</span> | pending {deepScanTask.pending} | leased {deepScanTask.leased} | failed {deepScanTask.failed} | completed {deepScanTask.completed}/{deepScanTask.total}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={retryReason}
                onChange={(e) => setRetryReason(e.target.value)}
                className="px-2.5 py-1.5 bg-zinc-900 border border-zinc-700 rounded-lg text-[10px] font-black text-zinc-300 uppercase tracking-widest"
              >
                <option value="all">all reasons</option>
                {Object.keys(deepScanTask.failedReasonStats || {}).map((reason) => (
                  <option key={reason} value={reason}>
                    {reason}
                  </option>
                ))}
              </select>
              <button
                onClick={handlePauseDeepScan}
                disabled={deepScanTask.status !== 'running'}
                className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 rounded-lg text-[10px] font-black text-zinc-300 uppercase tracking-widest disabled:opacity-40 flex items-center gap-1.5"
              >
                <Pause className="w-3 h-3" />
                Pause
              </button>
              <button
                onClick={handleResumeDeepScan}
                disabled={deepScanTask.status === 'completed'}
                className="px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 rounded-lg text-[10px] font-black text-blue-200 uppercase tracking-widest disabled:opacity-40 flex items-center gap-1.5"
              >
                <Play className="w-3 h-3" />
                Resume
              </button>
              <button
                onClick={handleRetryFailedDeepScan}
                disabled={deepScanTask.failed <= 0}
                className="px-3 py-1.5 bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 rounded-lg text-[10px] font-black text-amber-200 uppercase tracking-widest disabled:opacity-40 flex items-center gap-1.5"
              >
                <RotateCcw className="w-3 h-3" />
                Retry Failed
              </button>
              <button
                onClick={handleRefreshDeepScan}
                className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 rounded-lg text-[10px] font-black text-zinc-300 uppercase tracking-widest flex items-center gap-1.5"
              >
                <RefreshCw className="w-3 h-3" />
                Refresh
              </button>
              <button
                onClick={handleContinueDeepScan}
                className="px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 rounded-lg text-[10px] font-black text-emerald-200 uppercase tracking-widest flex items-center gap-1.5"
              >
                <Play className="w-3 h-3" />
                Continue Processing
              </button>
              <button
                onClick={handleExportFailedCsv}
                className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 rounded-lg text-[10px] font-black text-zinc-300 uppercase tracking-widest flex items-center gap-1.5"
              >
                <FileText className="w-3 h-3" />
                Export Failed CSV
              </button>
            </div>
          </div>
          <div className="text-[10px] text-zinc-500">
            Failed Reasons: {Object.entries(deepScanTask.failedReasonStats || {}).map(([reason, count]) => `${reason}:${count}`).join(' | ') || 'none'}
          </div>
          <div className="text-[10px] text-zinc-500">
            Failed Sample: {deepScanTask.failedItemsSample.length}
            {deepScanTask.failedItemsSample.length > 0
              ? ` | ${deepScanTask.failedItemsSample.slice(0, 5).map((item) => `${item.id}:${item.reason}`).join(', ')}`
              : ''}
          </div>
        </div>
      )}

      <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-4">
        <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Moved To Artist Analyzer</p>
        <p className="text-sm text-zinc-300 mt-2">
          Bot Live Feed, Relationship Mapping, and Manual Review are now in <span className="font-black">Artist Analyzer</span>.
        </p>
      </div>

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

      {/* State Selector & Search */}
      <div className="bg-[#111] border border-zinc-800/50 p-8 rounded-[2.5rem] relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-rose-600/5 blur-[80px] -mr-32 -mt-32 rounded-full" />
        
        <div className="flex flex-col md:flex-row gap-6 items-center justify-between mb-10 relative z-10">
          <div className="flex items-center gap-5">
            <div className="w-14 h-14 bg-rose-600 rounded-2xl flex items-center justify-center shadow-lg shadow-rose-600/20">
              <MapPin className="w-8 h-8 text-white" />
            </div>
            <div>
              <h3 className="text-2xl font-black tracking-tight text-white">Shop Outreach Manager</h3>
              <div className="flex items-center gap-3 mt-1">
                <p className="text-zinc-500 text-sm font-medium">Manage and approach tattoo shops by state.</p>
                <button 
                  onClick={() => onNavigate?.('automation')}
                  className="flex items-center gap-1.5 px-2 py-0.5 bg-blue-500/10 border border-blue-500/20 rounded-full hover:bg-blue-500/20 transition-all group"
                >
                  <Monitor className="w-3 h-3 text-blue-500 group-hover:scale-110 transition-transform" />
                  <span className="text-[10px] font-black text-blue-500 uppercase tracking-widest">
                    {assignments.filter(a => a.status === 'pending').length} Tasks Pending
                  </span>
                </button>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={async () => {
                toast.info("Synchronizing with cloud...");
                await loadData();
                toast.success("Cloud data synchronized!");
              }}
              className="p-4 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 rounded-2xl transition-all"
              title="Sync with Cloud"
            >
              <RefreshCw className="w-5 h-5" />
            </button>
            <button 
              onClick={() => setShowImport(true)}
              className="px-8 py-4 bg-rose-600 hover:bg-rose-500 text-white rounded-2xl flex items-center gap-3 transition-all text-sm font-black shadow-lg shadow-rose-600/20"
            >
              <Plus className="w-5 h-5" />
              Import Shop Data
            </button>
                          <button
                onClick={() => setShowScrape(true)}
                className="px-8 py-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl flex items-center gap-3 transition-all text-sm font-black shadow-lg shadow-emerald-600/20"
              >
                <Zap className="w-5 h-5" />
                Scrape State
              </button>
          </div>
        </div>

        <div className="flex flex-col md:flex-row gap-6 relative z-10">
          <div className="flex bg-zinc-900/50 p-1.5 rounded-2xl border border-zinc-800/50 overflow-x-auto no-scrollbar">
            {states.map(state => (
              <button
                key={state}
                onClick={() => setSelectedState(state)}
                className={cn(
                  "px-8 py-3 rounded-xl text-xs font-black transition-all whitespace-nowrap uppercase tracking-widest",
                  selectedState === state 
                    ? "bg-rose-600 text-white shadow-lg shadow-rose-600/20" 
                    : "text-zinc-500 hover:text-zinc-300"
                )}
              >
                {state}
              </button>
            ))}
          </div>
          <div className="relative flex-1 flex gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
              <input 
                type="text" 
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search shops, artists, or handles in state..."
                className="w-full pl-14 pr-6 py-4 bg-zinc-900/50 border border-zinc-800 focus:border-rose-500 rounded-2xl outline-none transition-all text-sm font-medium"
              />
            </div>
            <div className="relative">
              <Filter className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <select
                value={accountTagFilter}
                onChange={(e) => setAccountTagFilter(e.target.value)}
                className="pl-11 pr-8 py-4 bg-zinc-900/50 border border-zinc-800 focus:border-rose-500 rounded-2xl outline-none transition-all text-xs font-black uppercase tracking-widest text-zinc-400 appearance-none cursor-pointer"
              >
                <option value="all">All Places</option>
                <option value="default">Default</option>
                {/* Dynamically add other tags if available in artists */}
                {[...new Set(artists.filter(a => a && a.account_tag).map(a => a.account_tag))].map((tag: any) => (
                  <option key={tag} value={tag}>{tag}</option>
                ))}
              </select>
            </div>
            <div className="relative">
              <TrendingUp className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as any)}
                className="pl-11 pr-8 py-4 bg-zinc-900/50 border border-zinc-800 focus:border-rose-500 rounded-2xl outline-none transition-all text-xs font-black uppercase tracking-widest text-zinc-400 appearance-none cursor-pointer"
              >
                <option value="priority">High Intent</option>
                <option value="engagement">Engagement</option>
                <option value="active_now">Active Now</option>
                <option value="tattoo_likelihood">Tattoo Score</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showImport && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="bg-[#111] border border-rose-500/30 p-10 rounded-[2.5rem] relative overflow-hidden"
          >
            <div className="flex items-center justify-between mb-10">
              <div className="flex items-center gap-5">
                <div className="w-14 h-14 bg-rose-600/20 rounded-2xl flex items-center justify-center border border-rose-500/30">
                  <Terminal className="w-8 h-8 text-rose-500" />
                </div>
                <div className="flex-1">
                  <h3 className="text-2xl font-black tracking-tight text-white">Import Shop Leads</h3>
                  <p className="text-zinc-500 text-sm font-medium">Choose your preferred method to bring in new potential leads.</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex flex-col items-end">
                  <span className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-1">Account Tag</span>
                  <input 
                    type="text"
                    value={accountTag}
                    onChange={(e) => setAccountTag(e.target.value)}
                    placeholder="e.g. main_ig"
                    className="px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-[10px] font-bold text-zinc-300 focus:outline-none focus:border-rose-500/50 transition-all w-32"
                  />
                </div>
                <button 
                  onClick={() => setShowImport(false)}
                  className="p-3 hover:bg-white/10 rounded-xl transition-colors"
                >
                  <X className="w-6 h-6 text-zinc-500" />
                </button>
              </div>
            </div>
              <div className="flex bg-zinc-900/50 p-1 rounded-xl border border-zinc-800/50">
                <button 
                  onClick={() => setImportTab('magic')}
                  className={cn(
                    "px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                    importTab === 'magic' ? "bg-rose-600 text-white" : "text-zinc-500 hover:text-zinc-300"
                  )}
                >
                  Magic Script
                </button>
                <button 
                  onClick={() => setImportTab('csv')}
                  className={cn(
                    "px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                    importTab === 'csv' ? "bg-rose-600 text-white" : "text-zinc-500 hover:text-zinc-300"
                  )}
                >
                  CSV Upload
                </button>
                <button 
                  onClick={() => setImportTab('shopify')}
                  className={cn(
                    "px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2",
                    importTab === 'shopify' ? "bg-rose-600 text-white shadow-lg shadow-rose-600/20" : "text-zinc-500 hover:text-zinc-300"
                  )}
                >
                  <ShoppingBag className="w-3 h-3" />
                  Shopify Import (CSV)
                </button>
              </div>

            {importTab === 'magic' ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                <div className="space-y-8">
                  <div className="flex items-start gap-5">
                    <div className="w-10 h-10 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-sm font-black text-rose-500 shrink-0">1</div>
                    <p className="text-sm text-zinc-400 leading-relaxed">Open <a href="https://www.google.com/maps" target="_blank" rel="noreferrer" className="text-rose-500 hover:underline font-bold">Google Maps</a> in a new tab.</p>
                  </div>
                  <div className="flex items-start gap-5">
                    <div className="w-10 h-10 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-sm font-black text-rose-500 shrink-0">2</div>
                    <p className="text-sm text-zinc-400 leading-relaxed">Search for <span className="text-white font-bold">"Tattoo Shops in {selectedState}"</span>.</p>
                  </div>
                  <div className="flex items-start gap-5">
                    <div className="w-10 h-10 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-sm font-black text-rose-500 shrink-0">3</div>
                    <p className="text-sm text-zinc-400 leading-relaxed">Scroll down the results list to load all shops.</p>
                  </div>
                  <div className="flex items-start gap-5">
                    <div className="w-10 h-10 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-sm font-black text-rose-500 shrink-0">4</div>
                    <p className="text-sm text-zinc-400 leading-relaxed">Copy the script on the right and paste it into the browser console (F12).</p>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="p-6 bg-black rounded-3xl border border-zinc-800 relative group">
                    <pre className="text-[11px] text-amber-500/80 font-mono overflow-x-auto h-40 no-scrollbar leading-relaxed">
{`// 馃椇锔?Google Maps Shop Scraper
(async function() {
    let shops = [];
    const items = document.querySelectorAll('div[role="article"]');
    items.forEach(item => {
        try {
            const name = item.querySelector('.qBF1Pd')?.innerText || "Unknown Shop";
            const rating = item.querySelector('.MW4T7d')?.innerText || "N/A";
            const address = item.querySelector('.W4Efsd:last-child')?.innerText || "No Address";
            const website = item.querySelector('a[aria-label*="website"]')?.href || "No Website";
            shops.push({ name, rating, address, website });
        } catch (e) {}
    });
    const output = shops.map(s => \`\${s.name} | Rating: \${s.rating} | \${s.address} | \${s.website}\`).join('\\n');
    copy(output);
    alert(\`鉁?Found \${shops.length} shops! Data copied to clipboard.\`);
})();`}
                    </pre>
                    <button 
                      onClick={() => {
                        navigator.clipboard.writeText(`(async function() { let shops = []; const items = document.querySelectorAll('div[role="article"]'); items.forEach(item => { try { const name = item.querySelector('.qBF1Pd')?.innerText || "Unknown Shop"; const rating = item.querySelector('.MW4T7d')?.innerText || "N/A"; const address = item.querySelector('.W4Efsd:last-child')?.innerText || "No Address"; const website = item.querySelector('a[aria-label*="website"]')?.href || "No Website"; shops.push({ name, rating, address, website }); } catch (e) {} }); const output = shops.map(s => \`\${s.name} | Rating: \${s.rating} | \${s.address} | \${s.website}\`).join('\\n'); copy(output); alert(\`鉁?Found \${shops.length} shops! Data copied to clipboard.\`); })();`);
                        toast.success("Script copied to clipboard!");
                      }}
                      className="absolute right-4 top-4 p-3 bg-zinc-800 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity text-[10px] font-black uppercase tracking-widest flex items-center gap-2"
                    >
                      <Copy className="w-4 h-4" />
                      Copy Script
                    </button>
                  </div>
                  <button 
                    onClick={handleMagicPaste}
                    disabled={isScanning}
                    className="w-full py-5 bg-rose-600 hover:bg-rose-500 text-white rounded-2xl font-black uppercase tracking-widest transition-all flex items-center justify-center gap-3 group shadow-lg shadow-rose-600/20 disabled:opacity-50"
                  >
                    {isScanning ? <Loader2 className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5 group-hover:scale-125 transition-transform" />}
                    Magic Paste Leads
                  </button>
                </div>
              </div>
            ) : importTab === 'csv' ? (
              <div className="space-y-8">
                <div 
                  {...getRootProps()} 
                  className={cn(
                    "border-2 border-dashed rounded-[2.5rem] p-16 flex flex-col items-center justify-center transition-all cursor-pointer",
                    isDragActive ? "border-rose-500 bg-rose-500/5" : "border-zinc-800 hover:border-zinc-700 bg-zinc-900/20"
                  )}
                >
                  <input {...getInputProps()} />
                  <div className="w-20 h-20 bg-rose-600/10 rounded-3xl flex items-center justify-center border border-rose-500/20 mb-6">
                    <Upload className="w-10 h-10 text-rose-500" />
                  </div>
                  <h4 className="text-xl font-black text-white mb-2">Drop your CSV file here</h4>
                  <p className="text-zinc-500 text-sm font-medium mb-4">or click to browse your files</p>
                  <p className="text-[10px] text-amber-500 font-bold uppercase tracking-widest bg-amber-500/10 px-4 py-2 rounded-full border border-amber-500/20 mb-8">
                    馃殌 Massive Batch Mode: ~3s per 100 rows (Optimized for 2000+ leads)
                  </p>
                  
                  {uploadError && (
                    <div className="mb-6 p-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl flex items-center gap-3 text-rose-500 text-xs font-bold">
                      <AlertCircle className="w-4 h-4" />
                      {uploadError}
                    </div>
                  )}

                  <div className="flex items-center gap-4 text-[10px] font-black text-zinc-500 uppercase tracking-widest">
                    <div className="flex items-center gap-2">
                      <FileText className="w-3 h-3" />
                      Supports .csv
                    </div>
                    <div className="w-1 h-1 bg-zinc-800 rounded-full" />
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-3 h-3" />
                      Auto-mapping
                    </div>
                  </div>
                </div>

                <div className="bg-zinc-900/50 border border-zinc-800 p-6 rounded-3xl">
                  <h5 className="text-xs font-black text-white uppercase tracking-widest mb-4 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-rose-500" />
                    CSV Format Requirements
                  </h5>
                  <p className="text-xs text-zinc-500 leading-relaxed">
                    Your CSV should include headers like <span className="text-zinc-300 font-bold">shopName</span>, 
                    <span className="text-zinc-300 font-bold">mapsRating</span>, 
                    <span className="text-zinc-300 font-bold">igLink</span>, and 
                    <span className="text-zinc-300 font-bold">address</span>. 
                    We'll automatically map similar names (e.g., 'Name' to 'shopName').
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-8">
                <div 
                  {...getRootProps()} 
                  className={cn(
                    "border-2 border-dashed rounded-[2.5rem] p-16 flex flex-col items-center justify-center transition-all cursor-pointer",
                    isDragActive ? "border-rose-500 bg-rose-500/5" : "border-zinc-800 hover:border-zinc-700 bg-zinc-900/20"
                  )}
                >
                  <input {...getInputProps()} />
                  <div className="w-20 h-20 bg-rose-600/10 rounded-3xl flex items-center justify-center border border-rose-500/20 mb-6">
                    <ShoppingBag className="w-10 h-10 text-rose-500" />
                  </div>
                  <h4 className="text-xl font-black text-white mb-2">Drop Shopify Customers CSV</h4>
                  <p className="text-zinc-500 text-sm font-medium mb-4">Export your customers from Shopify (CSV) and drop them here</p>
                  
                  {uploadError && (
                    <div className="mb-6 p-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl flex items-center gap-3 text-rose-500 text-xs font-bold">
                      <AlertCircle className="w-4 h-4" />
                      {uploadError}
                    </div>
                  )}

                  <div className="flex items-center gap-4 text-[10px] font-black text-zinc-500 uppercase tracking-widest">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-3 h-3" />
                      Auto-match by Email/Phone
                    </div>
                    <div className="w-1 h-1 bg-zinc-800 rounded-full" />
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-3 h-3" />
                      Auto-update Conversion DNA
                    </div>
                  </div>
                </div>

                <div className="bg-zinc-900/50 border border-zinc-800 p-6 rounded-3xl">
                  <h5 className="text-xs font-black text-white uppercase tracking-widest mb-4 flex items-center gap-2">
                    <ShoppingBag className="w-4 h-4 text-rose-500" />
                    How Shopify Import Works
                  </h5>
                  <p className="text-xs text-zinc-500 leading-relaxed">
                    Upload your Shopify <span className="text-zinc-300 font-bold">Customers</span> export (CSV). 
                    We'll automatically match them using <span className="text-rose-500 font-bold">Email</span>, <span className="text-rose-500 font-bold">Phone</span>, or <span className="text-rose-500 font-bold">Default Address Company</span>. 
                    The system will also sync <span className="text-zinc-300 font-bold">Total Orders</span> and <span className="text-zinc-300 font-bold">Total Spent</span> to your CRM.
                  </p>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Shop List */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-[#111] border border-zinc-800/50 rounded-[2.5rem] overflow-hidden">
            <div className="p-8 border-b border-zinc-800/50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-zinc-900 rounded-xl flex items-center justify-center border border-zinc-800">
                  <Users className="w-5 h-5 text-rose-500" />
                </div>
                <h4 className="font-black text-xl text-white">Shops in {selectedState} ({filteredShops.length}/{artists.length})</h4>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-xl">
                  <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Active Leads</span>
                </div>
                <div className="flex items-center gap-3 px-4 py-2 bg-zinc-900/50 border border-zinc-800 rounded-xl">
                  <Database className="w-3.5 h-3.5 text-rose-500" />
                  <div className="flex flex-col">
                    <span className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Local Library</span>
                    <span className="text-[10px] font-bold text-zinc-300">{globalStats?.dbSize || '0 MB'}</span>
                  </div>
                </div>
                <button 
                  onClick={async () => {
                    const pending = assignments.filter(a => a.status === 'pending');
                    if (pending.length === 0) {
                      toast.error("No pending tasks to execute. Assign shops to automation first.");
                      return;
                    }
                    toast.info(`Executing protocol for ${pending.length} shops...`);
                    for (const a of pending) {
                      await startAutomationSequence(a.artistId, a.accountId);
                    }
                  }}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 border border-blue-400/20 rounded-xl text-[10px] font-black text-white uppercase tracking-widest transition-all flex items-center gap-2 shadow-lg shadow-blue-600/20"
                >
                  <Zap className="w-3 h-3" />
                  Execute Protocol
                </button>
                <button 
                  onClick={bulkEnrichArtists}
                  disabled={isScanning}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-500 border border-rose-400/20 rounded-xl text-[10px] font-black text-white uppercase tracking-widest transition-all flex items-center gap-2 disabled:opacity-50"
                >
                  <Brain className="w-3 h-3" />
                  Deep Scan All
                </button>
                <button 
                  onClick={() => {
                    const csv = Papa.unparse(artists);
                    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                    const link = document.createElement('a');
                    const url = URL.createObjectURL(blob);
                    link.setAttribute('href', url);
                    link.setAttribute('download', `inkflow_backup_${new Date().toISOString().split('T')[0]}.csv`);
                    link.style.visibility = 'hidden';
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    toast.success("Backup downloaded to your computer!");
                  }}
                  className="px-4 py-2 bg-zinc-900/50 hover:bg-zinc-900 border border-zinc-800 rounded-xl text-[10px] font-black text-zinc-500 uppercase tracking-widest transition-all"
                >
                  Export Backup
                </button>
                <button 
                  onClick={() => window.location.reload()}
                  className="px-4 py-2 bg-zinc-900/50 hover:bg-zinc-900 border border-zinc-800 rounded-xl text-[10px] font-black text-zinc-500 uppercase tracking-widest transition-all"
                >
                  Refresh
                </button>
                <button 
                  onClick={clearAllData}
                  className="px-4 py-2 bg-rose-600/10 hover:bg-rose-600/20 border border-rose-500/20 rounded-xl text-[10px] font-black text-rose-500 uppercase tracking-widest transition-all"
                >
                  Clear All
                </button>
              </div>
            </div>
            
            <div className="overflow-x-auto scrollbar-none border border-zinc-800/50 rounded-2xl bg-[#111]">
              <table className="w-full text-left border-collapse table-fixed">
                <thead>
                  <tr className="border-b border-zinc-800/50 bg-zinc-900/20">
                    <th className="p-3 text-[9px] font-black text-zinc-400 uppercase tracking-widest w-[22%]">Shop & Handle</th>
                    <th className="p-3 text-[9px] font-black text-zinc-400 uppercase tracking-widest w-[16%]">Location</th>
                    <th className="p-3 text-[9px] font-black text-zinc-400 uppercase tracking-widest w-[12%]">Followers</th>
                    <th className="p-3 text-[9px] font-black text-zinc-400 uppercase tracking-widest w-[15%]">Style</th>
                    <th className="p-3 text-[9px] font-black text-zinc-400 uppercase tracking-widest text-center w-[10%]">Heat</th>
                    <th className="p-3 text-[9px] font-black text-zinc-400 uppercase tracking-widest w-[10%]">Status</th>
                    <th className="p-3 text-[9px] font-black text-zinc-400 uppercase tracking-widest text-right w-[15%]">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/30">
                  {paginatedShops.length > 0 ? paginatedShops.map(shop => (
                    <tr key={shop.id} className="hover:bg-zinc-900/30 transition-colors group">
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <img 
                            src={shop.profilePic || `https://picsum.photos/seed/${shop.username}/100/100`} 
                            alt={shop.username} 
                            className="w-8 h-8 rounded-lg border border-zinc-800 object-cover shrink-0"
                            referrerPolicy="no-referrer"
                          />
                          <div className="min-w-0">
                            <h5 className="font-black text-white text-[11px] truncate leading-tight">
                              {cleanDisplay(shop.fullName || 'Unknown Shop')}
                            </h5>
                            <p className="text-[9px] text-rose-500 font-bold truncate">
                              @{cleanDisplay((!shop.username || typeof shop.username !== 'string' || shop.username.startsWith('user_')) ? (shop.fullName || 'artist').toLowerCase().replace(/\s+/g, '_') : shop.username)}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="flex flex-col gap-0">
                          <div className="flex items-center gap-1 text-zinc-300 min-w-0">
                            <MapPin className="w-2 h-2 text-zinc-500 shrink-0" />
                            <span className="text-[10px] font-bold truncate">
                              {cleanDisplay(
                                shop.city && shop.city !== 'Unknown'
                                  ? `${shop.city}${shop.state && shop.state !== 'Unknown' ? `, ${shop.state}` : ''}`
                                  : (shop.state && shop.state !== 'Unknown' ? shop.state : (shop.location || 'No Location'))
                              )}
                            </span>
                          </div>
                          <span className="text-[7px] text-zinc-500 uppercase tracking-widest ml-3 truncate block">{cleanDisplay(shop.country || 'USA')}</span>
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-1">
                          <Users className="w-2.5 h-2.5 text-zinc-500" />
                          <span className="text-[11px] font-black text-zinc-300 truncate">
                            {shop.followers && typeof shop.followers === 'number' ? shop.followers.toLocaleString() : (isScanning ? <Loader2 className="w-2 h-2 animate-spin text-zinc-600" /> : (shop.followers || '0'))}
                          </span>
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-1">
                          <Sparkles className="w-2.5 h-2.5 text-blue-500" />
                          <span className="px-1 py-0.5 bg-zinc-800/50 text-[8px] font-black rounded text-zinc-400 uppercase tracking-widest border border-zinc-700/30 truncate block max-w-[92px]">
                            {shop.style && shop.style !== 'Various' ? cleanDisplay(shop.style) : (isScanning ? <Loader2 className="w-2.5 h-2.5 animate-spin text-zinc-600" /> : 'Various')}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <span className="px-1 py-0.5 text-[7px] font-black rounded bg-zinc-900 border border-zinc-800 text-zinc-500">
                            ER {(shop.socialSignals?.engagementRate || 0).toFixed(1)}%
                          </span>
                          <span className="px-1 py-0.5 text-[7px] font-black rounded bg-zinc-900 border border-zinc-800 text-zinc-500">
                            H {Array.isArray(shop.socialSignals?.postingHours) && shop.socialSignals?.postingHours.length > 0
                              ? shop.socialSignals?.postingHours.slice(0, 3).join(',')
                              : '-'}
                          </span>
                        </div>
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex flex-col items-center">
                          <span className={cn(
                            "text-[10px] font-black",
                            shop.heatScore >= 80 ? "text-red-600" : "text-zinc-400"
                          )}>
                            {shop.heatScore}%
                          </span>
                          <div className="w-10 h-0.5 bg-zinc-800 rounded-full mt-0.5 overflow-hidden">
                            <div 
                              className={cn("h-full transition-all", shop.heatScore >= 80 ? "bg-red-600" : "bg-rose-600")} 
                              style={{ width: `${shop.heatScore}%` }} 
                            />
                          </div>
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-1">
                          <div className={cn(
                            "w-1 h-1 rounded-full",
                            shop.stage === 'customers' ? "bg-green-500" :
                            shop.stage === 'engaged' ? "bg-blue-500" : "bg-zinc-600"
                          )} />
                          <span className={cn(
                            "text-[8px] font-black uppercase tracking-widest",
                            shop.stage === 'customers' ? "text-green-500" :
                            shop.stage === 'engaged' ? "text-blue-500" : "text-zinc-500"
                          )}>
                            {shop.stage}
                          </span>
                        </div>
                      </td>
                      <td className="p-3 text-right transition-colors">
                        <div className="flex items-center justify-end gap-1">
                          <button 
                            onClick={() => assignTaskToAccount(shop.id)}
                            className="p-1.5 bg-zinc-900 border border-zinc-800 rounded text-zinc-500 hover:text-blue-500 transition-all"
                            title="Assign"
                          >
                            <Monitor className="w-3 h-3" />
                          </button>
                          <button 
                            onClick={() => {
                              if (confirmDeleteId === shop.id) {
                                deleteArtist(shop.id);
                                setConfirmDeleteId(null);
                              } else {
                                setConfirmDeleteId(shop.id);
                                setTimeout(() => setConfirmDeleteId(null), 2000);
                              }
                            }}
                            className={cn(
                              "p-1.5 border rounded transition-all",
                              confirmDeleteId === shop.id ? "bg-rose-600 border-rose-500 text-white" : "bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-rose-500"
                            )}
                            title="Delete"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                          <button 
                            onClick={() => window.open(`https://instagram.com/${shop.username}`, '_blank')}
                            className="p-1.5 bg-zinc-900 border border-zinc-800 rounded text-zinc-500 hover:text-rose-500 transition-all"
                          >
                            <Instagram className="w-3 h-3" />
                          </button>
                          <button 
                            onClick={() => moveArtist(shop.id, 'engaged')}
                            className="p-1.5 bg-rose-600 text-white rounded hover:bg-rose-500 transition-all shadow-lg shadow-rose-600/20"
                          >
                            <ChevronRight className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={7} className="p-32 text-center">
                        <div className="w-20 h-20 bg-zinc-900 rounded-[2rem] flex items-center justify-center border border-zinc-800 mx-auto mb-6">
                          <MapPin className="w-10 h-10 text-zinc-700" />
                        </div>
                        <h5 className="text-white font-black text-lg mb-2">No leads found</h5>
                        <p className="text-zinc-500 text-sm max-w-xs mx-auto">Use the Magic Import tool to scrape new shops directly from Google Maps.</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-6 bg-[#111] border border-zinc-800/50 p-6 rounded-2xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h5 className="text-white font-black text-lg">Sales And Distributor Panels Moved</h5>
                <p className="text-[11px] text-zinc-500 font-medium">
                  Direct Sales List, Distributor Board, Referral Queue, and Lifecycle are now managed in Artist Analyzer.
                </p>
              </div>
              <button
                onClick={() => onNavigate?.('analyzer')}
                className="px-3 py-2 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 rounded text-[10px] font-black text-emerald-200 uppercase tracking-widest"
              >
                Go To Artist Analyzer
              </button>
            </div>
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-8 py-4 border-t border-zinc-800 bg-zinc-900/30 rounded-b-[2.5rem]">
              <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">
                Showing {(currentPage - 1) * itemsPerPage + 1} - {Math.min(currentPage * itemsPerPage, filteredShops.length)} of {filteredShops.length}
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

        {/* AI Strategy */}
        <div className="lg:col-span-1 space-y-8">
          <div className="bg-[#111] border border-zinc-800/50 p-8 rounded-[2.5rem] sticky top-8">
            <div className="flex items-center gap-4 mb-8">
              <div className="w-12 h-12 bg-rose-600/10 rounded-2xl flex items-center justify-center border border-rose-500/20">
                <TrendingUp className="w-6 h-6 text-rose-500" />
              </div>
              <div>
                <h4 className="font-black text-xl text-white">AI Strategy</h4>
                <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-black">Market Intelligence</p>
              </div>
            </div>

            <p className="text-sm text-zinc-400 mb-8 leading-relaxed font-medium">
              Generate a personalized approach for shops in {selectedState} based on current market trends and shop profiles.
            </p>

            {strategy ? (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-6"
              >
                <div className="p-6 bg-rose-600/5 border border-rose-500/20 rounded-3xl text-sm leading-relaxed text-zinc-300 font-medium italic">
                  "{strategy}"
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <button 
                    onClick={handleGenerateStrategy}
                    className="py-4 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all text-zinc-300"
                  >
                    Regenerate
                  </button>
                  <button 
                    onClick={async () => {
                      const pending = assignments.filter(a => a.status === 'pending');
                      if (pending.length === 0) {
                        toast.error("No pending tasks to execute. Assign shops to automation first.");
                        return;
                      }
                      toast.info(`Executing protocol for ${pending.length} shops...`);
                      for (const a of pending) {
                        await startAutomationSequence(a.artistId, a.accountId);
                      }
                    }}
                    className="py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-blue-600/20 flex items-center justify-center gap-2"
                  >
                    <Zap className="w-3 h-3" />
                    Execute Protocol
                  </button>
                </div>
              </motion.div>
            ) : (
              <button 
                onClick={handleGenerateStrategy}
                disabled={isGeneratingStrategy}
                className="w-full py-5 bg-rose-600 hover:bg-rose-500 disabled:bg-zinc-900 disabled:text-zinc-700 text-white font-black uppercase tracking-widest rounded-2xl transition-all shadow-lg shadow-rose-600/20 flex items-center justify-center gap-3"
              >
                {isGeneratingStrategy ? <Loader2 className="w-6 h-6 animate-spin" /> : <Sparkles className="w-6 h-6" />}
                Generate Strategy
              </button>
            )}

            <div className="mt-10 pt-10 border-t border-zinc-800/50 space-y-5">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-2xl bg-green-500/10 flex items-center justify-center border border-green-500/20">
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                </div>
                <div>
                  <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Market Analysis</p>
                  <p className="text-xs text-zinc-300 font-bold">Updated Live</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-2xl bg-rose-500/10 flex items-center justify-center border border-rose-500/20">
                  <AlertCircle className="w-5 h-5 text-rose-500" />
                </div>
                <div>
                  <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">New Leads</p>
                  <p className="text-xs text-zinc-300 font-bold">{filteredShops.length} shops found</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-2xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                  <Monitor className="w-5 h-5 text-blue-500" />
                </div>
                <div>
                  <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Automation</p>
                  <p className="text-xs text-zinc-300 font-bold">{assignments.length} Active Tasks</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
<AnimatePresence>
  {showScrape && (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
    >
      <div className="relative bg-[#111] border border-zinc-800 rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
  <button
    onClick={() => setShowScrape(false)}
    className="absolute right-3 top-3 w-8 h-8 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500"
    aria-label="Close scrape window"
  >
    ×
  </button>
  <h3 className="text-xl font-black text-white mb-4 pr-10">One-Click Maps Scraper</h3>

  {/* 鍥藉杈撳叆 */}
  <input
    type="text"
    value={scrapeCustomCountry}
    onChange={async (e) => {
      const code = e.target.value.trim().toUpperCase();
      setScrapeCustomCountry(code);
      setScrapeStateCode('');
      setScrapeStateIsoCode('');
      setScrapeCities([]);
      setScrapeCityMeta(null);
      setManualCitiesText('');
      if (!code) {
        setScrapeStates([]);
        return;
      }
      try {
        const res = await fetch(`/api/states?country=${code}`);
        const data = await res.json();
        setScrapeStates(Array.isArray(data.states) ? data.states : []);
      } catch (err) {
        console.error('Failed to load states:', err);
        setScrapeStates([]);
      }
    }}
    placeholder="Input country ISO code, e.g. US / TH"
    className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-white mb-4"
  />

  {/* State/Province */}
  <select
    value={scrapeStateCode}
    onChange={async (e) => {
      const stateName = e.target.value;
      setScrapeStateCode(stateName);
      const selected = scrapeStates.find((s) => s.name === stateName);
      setScrapeStateIsoCode(selected?.isoCode || '');
      setScrapeCities([]);
      setScrapeCityMeta(null);
      setManualCitiesText('');

      if (!stateName || !scrapeCustomCountry) return;
      try {
        const res = await fetch('/api/cities', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            country: scrapeCustomCountry,
            state: stateName,
            stateCode: selected?.isoCode || ''
          })
        });
        const data = await res.json();
        const cities = Array.isArray(data?.cities) ? data.cities : [];
        setScrapeCities(cities);
        if (data?.meta) {
          setScrapeCityMeta({
            total: Number(data.meta.total || cities.length),
            sources: Object.fromEntries(
              Object.entries(data.meta.sources || {}).map(([k, v]) => [k, Number(v || 0)])
            )
          });
        }
        setManualCitiesText(cities.join('\n'));
        toast.success(`Loaded ${cities.length} cities`);
      } catch (err) {
        console.error('Failed to load cities:', err);
        toast.error('Failed to load cities');
      }
    }}
    disabled={scrapeStates.length === 0}
    className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-white mb-4"
  >
    <option value="">Select state/province</option>
    {scrapeStates.map((s) => (
      <option key={`${s.name}-${s.isoCode}`} value={s.name}>{s.name}</option>
    ))}
  </select>

  {/* 鎵嬪姩鍩庡競鍒楄〃 */}
  <div className="mb-4">
    <label className="block text-sm text-zinc-400 mb-2">City list (one city per line)</label>
    <textarea
      rows={4}
      value={manualCitiesText}
      onChange={(e) => setManualCitiesText(e.target.value)}
      placeholder={"e.g.\nSeattle\nSpokane\nTacoma"}
      className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-white"
    />
    <p className="text-xs text-zinc-500 mt-1">Loaded automatically after selecting state/province. You can still edit manually.</p>
    {scrapeCityMeta && (
      <p className="text-xs text-zinc-400 mt-1">
        Sources: {Object.entries(scrapeCityMeta.sources).map(([k, v]) => `${k} ${v}`).join(' + ')} | Total {scrapeCityMeta.total}
      </p>
    )}
  </div>

  <p className="text-xs text-zinc-500 mb-4">Browser mode enabled for stable Google Maps scraping.</p>

  {/* 杩涘害鏉?*/}
  {scrapeTaskId && (
    <div className="mb-4">
      <div className="flex justify-between text-xs text-zinc-400 mb-1">
        <span>Progress: {scrapeProgress.completed}/{scrapeProgress.total} cities</span>
        <span>{scrapeStatus === 'completed' ? 'Done' : scrapeStatus === 'failed' ? 'Failed' : 'Running...'} | shops {scrapeShopsSaved}</span>
      </div>
      <div className="w-full h-2 bg-zinc-900 rounded-full overflow-hidden">
        <div className="h-full bg-emerald-500 transition-all" style={{ width: `${scrapeProgress.total ? (scrapeProgress.completed / scrapeProgress.total) * 100 : 0}%` }} />
      </div>
    </div>
  )}

  {(scrapeRows.length > 0 || Boolean(scrapeResultsWarning)) && (
    <div className="mb-4">
      <label className="block text-sm text-zinc-400 mb-2">Live Results (latest 100)</label>
      {scrapeResultsWarning ? (
        <p className="text-xs text-amber-400 mb-2">Results temporarily unavailable, task is still running. Saved shops: {scrapeShopsSaved}</p>
      ) : null}
      <div className="max-h-48 overflow-auto border border-zinc-800 rounded-xl">
        <table className="w-full text-xs text-zinc-300">
          <thead className="bg-zinc-900/80 sticky top-0">
            <tr>
              <th className="text-left p-2">City</th>
              <th className="text-left p-2">Shop</th>
              <th className="text-left p-2">IG</th>
              <th className="text-left p-2">Website</th>
            </tr>
          </thead>
          <tbody>
            {scrapeRows.map((r, i) => (
              <tr key={`${r.place_id || r.shop_name || 'row'}-${i}`} className="border-t border-zinc-800">
                <td className="p-2">{r.city || ''}</td>
                <td className="p-2">{r.shop_name || ''}</td>
                <td className="p-2">{r.instagram || ''}</td>
                <td className="p-2 truncate max-w-[180px]">{r.website || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )}

  {/* 褰撳墠浠诲姟ID鏄剧ず + 澶嶅埗鎸夐挳 */}
  {scrapeTaskId && (
    <div className="mb-4">
      <label className="block text-sm text-zinc-400 mb-2">Current Task ID</label>
      <div className="flex gap-2">
        <input
          type="text"
          value={scrapeTaskId}
          readOnly
          className="flex-1 px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-white text-sm"
        />
        <button
          onClick={() => {
            navigator.clipboard.writeText(scrapeTaskId);
            toast.success('Task ID copied.');
          }}
          className="px-4 py-3 bg-zinc-700 hover:bg-zinc-600 text-white rounded-xl font-black"
        >
          Copy ID
        </button>
      </div>
      <p className="text-xs text-zinc-500 mt-1">Copy this ID to resume tracking after refresh.</p>
    </div>
  )}

  {/* 鎵嬪姩杈撳叆浠诲姟ID鏌ヨ */}
  <div className="mb-4">
    <label className="block text-sm text-zinc-400 mb-2">Existing Task ID</label>
    <div className="flex gap-2">
      <input
        type="text"
        value={manualTaskId}
        onChange={(e) => setManualTaskId(e.target.value)}
        placeholder="e.g. scrape_1743761234567"
        className="flex-1 px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-white"
      />
      <button
        onClick={async () => {
          if (!manualTaskId) return;
          const res = await fetch(`/api/scrape/status/${manualTaskId}`);
          if (!res.ok) {
            toast.error('Task not found or already finished.');
            return;
          }
          const data = await res.json();
          setScrapeTaskId(manualTaskId);
          setScrapeStatus(data.status);
          setScrapeProgress({ completed: data.completed, total: data.total });
          if (data.status === 'running' || data.status === 'paused') startPolling(manualTaskId);
          if (data.status === 'completed') toast.success('Task completed. You can export now.');
        }}
        className="px-4 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-black"
      >
        Query
      </button>
    </div>
  </div>

  {/* 宸叉湁浠诲姟涓嬫媺鍒楄〃 */}
  <div className="mb-4">
    <label className="block text-sm text-zinc-400 mb-2">Select Existing Task (optional)</label>
    <div className="flex gap-2">
      <select
        value={selectedTaskId}
        onChange={(e) => e.target.value && loadTask(e.target.value)}
        className="flex-1 px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-white"
      >
        <option value="">-- Select a task --</option>
        {tasksList.map(task => (
          <option key={task.id} value={task.id}>
            {task.id} - {task.status} ({task.completed}/{task.total})
          </option>
        ))}
      </select>
      <button
        onClick={async () => {
          const res = await fetch('/api/scrape/tasks');
          if (!res.ok) return toast.error('Failed to load task list');
          setTasksList(await res.json());
        }}
        className="px-4 py-3 bg-zinc-700 hover:bg-zinc-600 text-white rounded-xl"
      >
        Refresh List
      </button>
    </div>
    <p className="text-xs text-zinc-500 mt-1">Select a task to view progress and export data.</p>
  </div>

  {/* 鎸夐挳缁?*/}
  <div className="flex gap-3">
  {scrapeStatus !== 'running' && scrapeStatus !== 'paused' && (
    <button
      onClick={startScrape}
      disabled={!scrapeCustomCountry || !scrapeStateCode}
      className="flex-1 px-6 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white rounded-xl font-black transition-all"
    >
      {scrapeStatus === 'completed' ? 'Re-scrape' : 'Start Scrape'}
    </button>
  )}

  {scrapeStatus === 'running' && (
    <button
      onClick={async () => {
        if (scrapeTaskId) {
          await fetch(`/api/scrape/pause/${scrapeTaskId}`, { method: 'POST' });
          setScrapeStatus('paused');
          if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
        }
      }}
      className="flex-1 px-6 py-3 bg-amber-600 hover:bg-amber-500 text-white rounded-xl font-black"
    >
      Pause
    </button>
  )}

  {scrapeStatus === 'paused' && (
    <button
      onClick={async () => {
        if (scrapeTaskId) {
          await fetch(`/api/scrape/resume/${scrapeTaskId}`, { method: 'POST' });
          setScrapeStatus('running');
          startPolling(scrapeTaskId || undefined);
        }
      }}
      className="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-black"
    >
      Resume
    </button>
  )}

  {(scrapeStatus === 'running' || scrapeStatus === 'paused') && (
    <button
      onClick={async () => {
        if (scrapeTaskId) {
          await fetch(`/api/scrape/cancel/${scrapeTaskId}`, { method: 'POST' });
          setScrapeStatus('cancelled');
          setShowScrape(false);
          if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
        }
      }}
      className="px-6 py-3 bg-rose-600 hover:bg-rose-500 text-white rounded-xl font-black"
    >
      Cancel
    </button>
  )}

  {/* 瀵煎嚭鎸夐挳 - 浠呭湪 completed 鏃舵樉绀?*/}
  {scrapeStatus === 'completed' && (
    <button
      onClick={async () => {
        const res = await fetch(`/api/scrape/export/${scrapeTaskId}`);
        if (!res.ok) {
          toast.error('Export failed. Please check backend API.');
          return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `scrape_${scrapeTaskId}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }}
      className="flex-1 px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-black"
    >
      Export CSV
    </button>
  )}

  {/* 鍏抽棴鎸夐挳 - 鍦?completed/cancelled/failed 鏃舵樉绀?*/}
  {(scrapeStatus === 'completed' || scrapeStatus === 'cancelled' || scrapeStatus === 'failed') && (
    <button onClick={() => setShowScrape(false)} className="px-6 py-3 bg-zinc-900 border border-zinc-800 text-zinc-400 rounded-xl">
      Close
    </button>
  )}
</div>
</div>
    </motion.div>
  )}
</AnimatePresence>
      </>
    );
}






