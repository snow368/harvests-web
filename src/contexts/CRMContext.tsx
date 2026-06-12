
import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { CRMArtist, CRMStage, AIPersona, CRMInteraction, CRMOrder, InstagramAccount, TaskAssignment, AccountBehavior } from '../types/crm';
import { toast } from 'sonner';
import { processArtistBatchAI, setMockMode as setGeminiMockMode } from '../lib/gemini';
import { db, auth, signInWithGoogle, logoutUser } from '../lib/firebase';
import localforage from 'localforage';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  doc, 
  setDoc, 
  writeBatch, 
  getDocs,
  deleteDoc,
  Timestamp
} from 'firebase/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';
import { safeJsonParse } from '../lib/gemini';

// Helper to sanitize data for Firestore
const sanitizeForFirestore = (obj: any): any => {
  if (obj === null || obj === undefined) return null;
  if (typeof obj === 'function') return null;
  if (Array.isArray(obj)) return obj.map(sanitizeForFirestore);
  if (obj instanceof Date) return obj.toISOString();
  if (typeof obj === 'object') {
    const sanitized: any = {};
    Object.keys(obj).forEach(key => {
      const value = obj[key];
      if (value !== undefined && typeof value !== 'function') {
        sanitized[key] = sanitizeForFirestore(value);
      }
    });
    return sanitized;
  }
  return obj;
};

// Configure localforage for Local-First fallback
localforage.config({
  name: 'InkFlowAI',
  storeName: 'crm_cache'
});

interface ConversionDNA {
  topStyles: string[];
  topLocations: string[];
  avgFollowers: number;
  topActivityLevels: string[];
}

interface CRMContextType {
  artists: CRMArtist[];
  interactions: CRMInteraction[];
  orders: CRMOrder[];
  persona: AIPersona;
  setPersona: (persona: AIPersona) => void;
  conversionDNA: ConversionDNA | null;
  moveArtist: (artistId: string, toStage: CRMStage) => void;
  updateArtist: (artistId: string, updates: Partial<CRMArtist>) => void;
  addInteraction: (artistId: string, type: CRMInteraction['type'], content?: string) => Promise<void>;
  addOrder: (artistId: string, productName: string, amount: number) => Promise<void>;
  markAsConverted: (artistId: string) => void;
  importCSV: (data: any[], defaultLocation?: string) => Promise<void>;
  syncShopifySales: (data: any[]) => Promise<void>;
  bulkEnrichArtists: () => Promise<void>;
  clearAllData: () => void;
  markAsIdealTarget: (artistId: string) => void;
  submitFeedback: (artistId: string, type: 'success' | 'failure') => void;
  refreshHarvestList: () => void;
  deleteArtist: (artistId: string) => Promise<void>;
  cleanupOldFirestoreData: () => Promise<void>;
  analyzeArtistVisualDNA: (artistId: string, imageUrl: string) => Promise<void>;
  findSimilarArtists: (artistId: string) => { artist: CRMArtist; reason: string }[];
  isScanning: boolean;
  setIsScanning: (val: boolean) => void;
  isRefreshing: boolean;
  scanProgress: { current: number, total: number };
  pinnedCount: number;
  mockMode: boolean;
  setMockMode: (mode: boolean) => void;
  debugMode: boolean;
  setDebugMode: (mode: boolean) => void;
  simulateInteraction: (artistId: string, points: number) => Promise<void>;
  seedTestData: () => Promise<void>;
  globalWeights: Record<string, number>;
  harvestList: CRMArtist[];
  user: User | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  isAuthReady: boolean;
  globalStats: any;
  accounts: InstagramAccount[];
  assignments: TaskAssignment[];
  assignTaskToAccount: (artistId: string) => Promise<string | null>;
  startAutomationSequence: (artistId: string, accountId: string) => Promise<void>;
}

const CRMContext = createContext<CRMContextType | undefined>(undefined);

// Generate some mock data
const generateMockArtists = (count: number): CRMArtist[] => {
  return []; // Disabled to prevent polluting real data
};

export const CRMProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [rawArtists, setRawArtists] = useState<CRMArtist[]>([]);
  const [interactions, setInteractions] = useState<CRMInteraction[]>([]);
  const [orders, setOrders] = useState<CRMOrder[]>([]);
  const [accounts, setAccounts] = useState<InstagramAccount[]>([]);
  const [assignments, setAssignments] = useState<TaskAssignment[]>([]);
  const rawArtistsRef = useRef<CRMArtist[]>([]);

  useEffect(() => {
    rawArtistsRef.current = rawArtists;
  }, [rawArtists]);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [persona, setPersona] = useState<AIPersona>('professional');
  const [isScanning, setIsScanning] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const isScanningRef = useRef(false);
  const lastLocalUpdateRef = useRef<number>(0);
  useEffect(() => {
    isScanningRef.current = isScanning;
  }, [isScanning]);
  const [scanProgress, setScanProgress] = useState({ current: 0, total: 0 });
  const [pinnedCount, setPinnedCount] = useState(0);
  const [mockMode, setMockModeState] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  const [globalWeights, setGlobalWeights] = useState<Record<string, number>>({
    'Realism': 1.0,
    'Traditional': 1.0,
    'Black & Grey': 1.0,
    'Fine Line': 1.0,
    'Neo-Traditional': 1.0,
    'London': 1.0,
    'New York': 1.0,
    'Berlin': 1.0,
    'Tokyo': 1.0,
    'Paris': 1.0,
    'Seoul': 1.0,
    'high': 1.0,
    'medium': 1.0,
    'low': 1.0
  });

  const setMockMode = useCallback((mode: boolean) => {
    setMockModeState(mode);
    setGeminiMockMode(mode);
    if (mode) {
      toast.info('Mock Mode Enabled', {
        description: 'API calls will be simulated with a 2s delay.'
      });
    } else {
      toast.info('Mock Mode Disabled', {
        description: 'Real API calls will be made.'
      });
    }
  }, []);

  const [pagination, setPagination] = useState({ total: 0, page: 1, totalPages: 1 });
  const [globalStats, setGlobalStats] = useState<any[]>([]);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthReady(true);
      if (u) {
        console.log("User authenticated:", u.email);
      }
    });
    return () => unsubscribe();
  }, []);

  const login = async () => {
    try {
      await signInWithGoogle();
    } catch (e) {
      toast.error("Login failed");
    }
  };

  const logout = async () => {
    try {
      await logoutUser();
      setRawArtists([]);
      setInteractions([]);
      setOrders([]);
      setAccounts([]);
      setAssignments([]);
      toast.success("Logged out successfully");
    } catch (e) {
      toast.error("Logout failed");
    }
  };

  // Keep pagination total in sync with artists length
  useEffect(() => {
    setPagination(prev => ({
      ...prev,
      total: rawArtists.length,
      totalPages: Math.ceil(rawArtists.length / 50) || 1
    }));
  }, [rawArtists.length]);

  // Initial load from Local and Firestore
  const loadData = useCallback(async () => {
    if (!user) return;

    try {
      // 1. Load from Local Storage first (Instant)
      const cached = await localforage.getItem<CRMArtist[]>(`artists_${user.uid}`);
      if (cached && cached.length > 0) {
        setRawArtists(cached);
        setIsInitialLoad(false);
      }

      // 1b. Load from Neon as primary data source (bulk)
      try {
        const neonRes = await fetch('/api/artists');
        if (neonRes.ok) {
          const neonArtists: CRMArtist[] = (await neonRes.json()).map((r: any) => ({
            id: r.id || r.uid,
            uid: r.uid || user.uid,
            username: r.username || '',
            fullName: r.full_name || r.shop_name || '',
            shopName: r.shop_name || '',
            stage: r.stage || 'outreach',
            heatScore: r.rating ? Math.min(100, Math.round(r.rating * 10)) : 0,
            similarityScore: 50,
            dnaTags: [],
            lastInteractionDate: r.last_updated || '',
            orderCount: 0,
            address: r.address || '',
            phone: r.phone || '',
            email: r.email || '',
            website: r.website || '',
            ig_handle: r.ig_handle || '',
            location: r.city || '',
            country: r.import_region || '',
            rating: r.rating || 0,
            mapsRating: r.rating || 0,
            followers: r.followers || 0,
            profilePic: r.profile_pic || '',
            location_tag: r.city || '',
            metadata: { source: 'neon', import_region: r.import_region, conversion_score: r.conversion_score || 0 }
          }));
          setRawArtists(prev => {
            // Neon is the primary source — replace local cache entirely
            localforage.setItem(`artists_${user.uid}`, neonArtists);
            return neonArtists;
          });
        }
      } catch (e) {
        console.warn('Neon load failed, falling back to Firestore only:', e);
      }

      // 2. Sync Artists from Firestore
      const qArtists = query(collection(db, 'artists'), where('uid', '==', user.uid));
      const unsubArtists = onSnapshot(qArtists, (snapshot) => {
        const cloudData = snapshot.docs.map(doc => doc.data() as CRMArtist);
        
        setRawArtists(prev => {
          const mergedMap = new Map<string, CRMArtist>();
          
          // 1. Start with existing local state
          prev.forEach(a => mergedMap.set(a.id, a));
          
          // 2. Overwrite with cloud data only for records that already exist
          // (from Neon). Old Firestore data from prior imports is ignored.
          // User-modified records (stage changes, interactions) update existing ones.
          cloudData.forEach(a => {
            if (mergedMap.has(a.id)) {
              const existing = mergedMap.get(a.id)!;
              // Firestore may have stale data without enrichment fields — preserve them from Neon
              mergedMap.set(a.id, {
                ...a,
                followers: a.followers || existing.followers,
                profilePic: a.profilePic || existing.profilePic,
                ig_handle: a.ig_handle || existing.ig_handle,
              });
            }
          });
          
          // 3. Handle deletions: ONLY delete if we are SURE it's a deletion from another client
          // We avoid aggressive deletion during initial sync to prevent race conditions with local imports
          if (!snapshot.metadata.fromCache && snapshot.metadata.hasPendingWrites === false) {
            const cloudIds = new Set(cloudData.map(a => a.id));
            // Only delete if the item was already synced (has a UID) and is missing from cloud
            // AND we haven't recently updated it locally
            // NEVER delete records that came from Neon (they don't live in Firestore)
            const now = Date.now();
            prev.forEach(a => {
              const isRecentlyUpdated = lastLocalUpdateRef.current && (now - lastLocalUpdateRef.current < 30000);
              const fromNeon = a.metadata?.source === 'neon';
              if (a.uid === user.uid && !cloudIds.has(a.id) && !isRecentlyUpdated && !fromNeon) {
                mergedMap.delete(a.id);
              }
            });
          }
          
          const merged = Array.from(mergedMap.values());
          localforage.setItem(`artists_${user.uid}`, merged);
          return merged;
        });
        
        setIsInitialLoad(false);
      });

      // 3. Sync Interactions from Firestore
      const qInteractions = query(collection(db, 'interactions'), where('uid', '==', user.uid));
      const unsubInteractions = onSnapshot(qInteractions, (snapshot) => {
        const cloudData = snapshot.docs.map(doc => doc.data() as CRMInteraction);
        setInteractions(prev => {
          const mergedMap = new Map<string, CRMInteraction>();
          prev.forEach(i => mergedMap.set(i.id, i));
          cloudData.forEach(i => mergedMap.set(i.id, i));
          return Array.from(mergedMap.values());
        });
      });

      // 4. Sync Orders from Firestore
      const qOrders = query(collection(db, 'orders'), where('uid', '==', user.uid));
      const unsubOrders = onSnapshot(qOrders, (snapshot) => {
        const cloudData = snapshot.docs.map(doc => doc.data() as CRMOrder);
        setOrders(prev => {
          const mergedMap = new Map<string, CRMOrder>();
          prev.forEach(o => mergedMap.set(o.id, o));
          cloudData.forEach(o => mergedMap.set(o.id, o));
          return Array.from(mergedMap.values());
        });
      });

      // 5. Sync Accounts from Firestore
      const qAccounts = query(collection(db, 'accounts'), where('uid', '==', user.uid));
      const unsubAccounts = onSnapshot(qAccounts, (snapshot) => {
        const cloudData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InstagramAccount));
        setAccounts(cloudData);
        
        if (cloudData.length === 0) {
          const mockAccounts: InstagramAccount[] = [
            { id: 'acc_1', username: 'inkflow_bot_1', behaviorProfile: 'observer', status: 'idle', dailyActionCount: 0 },
            { id: 'acc_2', username: 'inkflow_bot_2', behaviorProfile: 'active', status: 'idle', dailyActionCount: 0 }
          ];
          mockAccounts.forEach(acc => {
            setDoc(doc(db, 'accounts', acc.id), { ...acc, uid: user.uid });
          });
        }
      });

      // 6. Sync Assignments from Firestore
      const qAssignments = query(collection(db, 'assignments'), where('uid', '==', user.uid));
      const unsubAssignments = onSnapshot(qAssignments, (snapshot) => {
        const cloudData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as TaskAssignment));
        setAssignments(cloudData);
      });

      // Return cleanup function
      return () => {
        unsubArtists();
        unsubInteractions();
        unsubOrders();
        unsubAccounts();
        unsubAssignments();
      };
    } catch (error) {
      console.error("Error loading data:", error);
      setIsInitialLoad(false);
      return () => {};
    }
  }, [user]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    if (user) {
      loadData().then(unsub => {
        cleanup = unsub;
      });
    }
    return () => {
      if (cleanup) cleanup();
    };
  }, [user, loadData]);

  // Calculate Conversion DNA from Customers
  const conversionDNA = useMemo(() => {
    const customers = rawArtists.filter(a => a.stage === 'customers' && a.orderCount > 0);
    if (customers.length < 3) return null; // Need a baseline

    const styles: Record<string, number> = {};
    const locations: Record<string, number> = {};
    const activity: Record<string, number> = {};
    let totalFollowers = 0;

    customers.forEach(c => {
      if (c.style) styles[c.style] = (styles[c.style] || 0) + 1;
      if (c.location) locations[c.location] = (locations[c.location] || 0) + 1;
      if (c.activityLevel) activity[c.activityLevel] = (activity[c.activityLevel] || 0) + 1;
      totalFollowers += c.followers || 0;
    });

    const getTop = (record: Record<string, number>) => 
      Object.entries(record).sort((a, b) => b[1] - a[1]).slice(0, 2).map(e => e[0]);

    return {
      topStyles: getTop(styles),
      topLocations: getTop(locations),
      avgFollowers: totalFollowers / customers.length,
      topActivityLevels: getTop(activity)
    };
  }, [rawArtists]);

  // Derive artists with similarity scores and weighted ranking
  const artists = useMemo(() => {
    return rawArtists
      .filter(a => a && typeof a === 'object')
      .map(a => {
        let baseScore = 0;
        let currentStage = a.stage;

      // 0. Check for Dormancy (90 days) and Restock Alerts (45-60 days)
      if (a.stage === 'customers' && a.lastOrderDate) {
        const lastOrder = new Date(a.lastOrderDate);
        const daysSinceOrder = (Date.now() - lastOrder.getTime()) / (1000 * 60 * 60 * 24);
        
        if (daysSinceOrder > 90) {
          currentStage = 'dormant';
        }
      }
      
      // 1. Base Similarity from Conversion DNA (if exists)
      if (conversionDNA) {
        if (a.style && conversionDNA.topStyles.includes(a.style)) baseScore += 40;
        if (a.location && conversionDNA.topLocations.includes(a.location)) baseScore += 30;
        if (a.activityLevel && conversionDNA.topActivityLevels.includes(a.activityLevel)) baseScore += 20;
        if (a.followers && Math.abs(a.followers - conversionDNA.avgFollowers) < conversionDNA.avgFollowers * 0.5) {
          baseScore += 10;
        }
      } else {
        // Fallback base score if no DNA yet
        baseScore = 50; 
      }

      // 2. Apply Learned Global Weights (The "Smart Discovery" part)
      let weightedScore = baseScore;
      const tags = [a.style, a.location, a.activityLevel].filter(Boolean) as string[];
      
      tags.forEach(tag => {
        if (globalWeights[tag]) {
          weightedScore *= globalWeights[tag];
        }
      });

      return { 
        ...a, 
        stage: currentStage,
        similarityScore: Math.min(100, Math.round(weightedScore)) 
      };
    });
  }, [rawArtists, conversionDNA, globalWeights]);

  const harvestList = useMemo(() => {
    return artists
      .filter(a => a.stage === 'outreach' || a.stage === 'dormant')
      .sort((a, b) => {
        // 1. Calculate Priority Score
        // Base: Heat Score + Similarity Score
        let aPriority = (a.heatScore || 0) + (a.similarityScore || 0);
        let bPriority = (b.heatScore || 0) + (b.similarityScore || 0);

        // 2. Massive Boost for "Just Followed Back" (The "Harvest" trigger)
        if (a.hasFollowedBack && a.stage === 'outreach') aPriority += 100;
        if (b.hasFollowedBack && b.stage === 'outreach') bPriority += 100;

        // 3. Boost for Dormant Re-activation
        if (a.stage === 'dormant') aPriority += 50;
        if (b.stage === 'dormant') bPriority += 50;

        // 4. Recency Boost (Interaction within last 24h)
        const dayInMs = 24 * 60 * 60 * 1000;
        if (a.lastInteractionDate && (Date.now() - new Date(a.lastInteractionDate).getTime() < dayInMs)) aPriority += 20;
        if (b.lastInteractionDate && (Date.now() - new Date(b.lastInteractionDate).getTime() < dayInMs)) bPriority += 20;

        return bPriority - aPriority;
      })
      .slice(0, 50);
  }, [artists]);

  const refreshHarvestList = useCallback(() => {
    setIsRefreshing(true);
    toast.info('Re-calculating Daily Harvest List based on updated feature weights...');
    setTimeout(() => {
      setIsRefreshing(false);
      toast.success('Daily Harvest List Refreshed', {
        description: 'Targeting accuracy improved based on recent feedback.'
      });
    }, 1500);
  }, []);

  const calculateHeatScore = (artist: CRMArtist): { score: number, isHighIntent: boolean } => {
    // view_count * 1 + like_count * 5 + comment_count * 20 + follow_back * 40
    const interactionScore = (artist.storyViews24h || 0) * 1 + 
                            (artist.likeCount || 0) * 5 + 
                            (artist.replyCount || 0) * 20 + 
                            (artist.hasFollowedBack ? 40 : 0);
    
    // Use the higher of the current score or the calculated interaction score
    // This prevents manually seeded high scores from being reset by the first interaction
    const currentScore = artist.heatScore || 0;
    const finalScore = Math.max(currentScore, interactionScore);
    
    const isHighIntent = finalScore >= 80;
    return { score: Math.min(100, finalScore), isHighIntent };
  };

  const moveArtist = useCallback(async (artistId: string, toStage: CRMStage) => {
    if (!user) return;
    
    // 1. Update Local State & Cache immediately
    setRawArtists(prev => {
      const updated = prev.map(a => a.id === artistId ? { ...a, stage: toStage } : a);
      localforage.setItem(`artists_${user.uid}`, updated);
      return updated;
    });
    toast.success(`Artist moved to ${toStage}`);

    // 2. Try Cloud Sync
    try {
      const docRef = doc(db, 'artists', artistId);
      await setDoc(docRef, sanitizeForFirestore({ stage: toStage }), { merge: true });
    } catch (e: any) {
      console.error("Failed to sync move to cloud", e);
      if (e.message.includes("resource-exhausted")) {
        console.warn("Cloud quota hit. Move saved locally.");
      }
    }
  }, [user]);

  const updateArtist = useCallback(async (artistId: string, updates: Partial<CRMArtist>) => {
    if (!user) return;
    
    // 1. Calculate and Update Local State & Cache immediately
    setRawArtists(prev => {
      const artist = prev.find(a => a.id === artistId);
      if (!artist) return prev;
      
      const updatedItem = { ...artist, ...updates };
      const { score, isHighIntent } = calculateHeatScore(updatedItem);
      const finalItem = { ...updatedItem, heatScore: score, isHighIntent };
      
      const updatedList = prev.map(a => a.id === artistId ? finalItem : a);
      localforage.setItem(`artists_${user.uid}`, updatedList);
      return updatedList;
    });

    // 2. Try Cloud Sync
    try {
      const artist = rawArtistsRef.current.find(a => a.id === artistId);
      if (!artist) return;
      
      const updated = { ...artist, ...updates };
      const { score, isHighIntent } = calculateHeatScore(updated);
      const finalUpdates = { ...updates, heatScore: score, isHighIntent };
      
      const docRef = doc(db, 'artists', artistId);
      await setDoc(docRef, sanitizeForFirestore(finalUpdates), { merge: true });
    } catch (e: any) {
      console.error("Failed to sync update to cloud", e);
    }
  }, [user]);

  const addInteraction = useCallback(async (artistId: string, type: CRMInteraction['type'], content?: string) => {
    if (!user) return;
    
    const weights = {
      'like': 5,
      'comment': 20,
      'follow': 25,
      'story_view': 1,
      'dm_reply': 40,
      'follow_back': 40
    };

    const interactionId = `int_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const newInteraction: CRMInteraction = {
      id: interactionId,
      artistId,
      type,
      weight: weights[type],
      timestamp: new Date().toISOString(),
      content
    };

    try {
      await setDoc(doc(db, 'interactions', interactionId), { ...newInteraction, uid: user.uid });
      
      // Update artist heat score
      const artist = rawArtists.find(a => a.id === artistId);
      if (artist) {
        const updates: Partial<CRMArtist> = {
          lastInteractionDate: newInteraction.timestamp
        };

        if (type === 'like') updates.likeCount = (artist.likeCount || 0) + 1;
        if (type === 'comment') updates.replyCount = (artist.replyCount || 0) + 1;
        if (type === 'story_view') updates.storyViews24h = (artist.storyViews24h || 0) + 1;
        if (type === 'follow_back') updates.hasFollowedBack = true;
        if (type === 'reply' || type === 'dm_reply') {
          updates.stage = 'engaged';
        }

        const updatedArtist = { ...artist, ...updates };
        const { score, isHighIntent } = calculateHeatScore(updatedArtist);
        
        updates.heatScore = score;
        updates.isHighIntent = isHighIntent;

        // Threshold Trigger: If heat_score >= 80, set status to 'engaged' and trigger a UI alert
        if (score >= 80 && artist.stage === 'outreach') {
          updates.stage = 'engaged';
          toast.success('🔥 High-Value Connection Detected!', {
            description: `@${artist.username} has reached a high heat score. Moving to Engaged stage.`,
            duration: 5000
          });
        }

        await updateArtist(artistId, updates);
      }
    } catch (error) {
      console.error("Error adding interaction:", error);
    }
  }, [user, rawArtists, updateArtist, calculateHeatScore]);

  const getCustomerTier = (orderCount: number, totalSpent: number = 0): 'new' | 'loyal' | 'vip' => {
    if (orderCount >= 5 || totalSpent > 1000) return 'vip';
    if (orderCount >= 2) return 'loyal';
    return 'new';
  };

  const addOrder = useCallback(async (artistId: string, productName: string, amount: number) => {
    if (!user) return;

    const orderId = `ord_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const newOrder: CRMOrder = {
      id: orderId,
      artistId,
      productName,
      amount,
      orderDate: new Date().toISOString()
    };

    try {
      await setDoc(doc(db, 'orders', orderId), { ...newOrder, uid: user.uid });
      
      const artist = rawArtists.find(a => a.id === artistId);
      if (artist) {
        const newOrderCount = (artist.orderCount || 0) + 1;
        const newTotalSpent = (artist.totalSpent || 0) + amount;
        const newTier = getCustomerTier(newOrderCount, newTotalSpent);
        
        await updateArtist(artistId, {
          orderCount: newOrderCount,
          totalSpent: newTotalSpent,
          lastOrderDate: newOrder.orderDate,
          stage: 'customers',
          customerTier: newTier
        });

        toast.success(`Order recorded! ${artist.username} is now a ${newTier} customer.`);
      }
    } catch (error) {
      console.error("Error adding order:", error);
    }
  }, [user, rawArtists, updateArtist]);

  const deleteArtist = useCallback(async (artistId: string) => {
    if (!user) return;
    
    try {
      // 1. Update Local State & Cache
      setRawArtists(prev => {
        const updatedList = prev.filter(a => a.id !== artistId);
        localforage.setItem(`artists_${user.uid}`, updatedList);
        return updatedList;
      });

      // 2. Delete from Firestore
      const docRef = doc(db, 'artists', artistId);
      await deleteDoc(docRef);
      
      toast.success("Lead permanently deleted", {
        description: "The artist has been removed from your CRM and cloud storage."
      });
    } catch (e) {
      console.error("Failed to delete artist", e);
      toast.error("Failed to remove artist from cloud");
    }
  }, [user]);

  const analyzeArtistVisualDNA = useCallback(async (artistId: string, imageUrl: string) => {
    if (!user) return;
    
    try {
      const response = await fetch('/api/analyze-visual-dna', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl })
      });
      
      if (!response.ok) throw new Error('Failed to analyze visual DNA');
      
      const text = await response.text();
      const result = safeJsonParse(text, null);
      
      if (!result) throw new Error('Invalid analysis result');
      
      await updateArtist(artistId, { visualDNA: result });
      toast.success('Visual DNA Analysis Complete', {
        description: `Style identified: ${result.style}`
      });
    } catch (e) {
      console.error("Visual DNA Analysis failed", e);
      toast.error("AI Analysis failed. Please check the image URL or try again.");
    }
  }, [user, updateArtist]);

  const findSimilarArtists = useCallback((artistId: string) => {
    const sourceArtist = rawArtists.find(a => a.id === artistId);
    if (!sourceArtist || !sourceArtist.visualDNA) return [];

    return rawArtists
      .filter(a => a.id !== artistId)
      .map(target => {
        let score = 0;
        let reasons: string[] = [];

        if (target.visualDNA?.style === sourceArtist.visualDNA?.style) {
          score += 50;
          reasons.push(`Same Style: ${sourceArtist.visualDNA?.style}`);
        }

        if (target.location_tag === sourceArtist.location_tag && sourceArtist.location_tag) {
          score += 30;
          reasons.push(`Same Location: ${sourceArtist.location_tag}`);
        }

        const commonTags = target.dnaTags.filter(tag => sourceArtist.dnaTags.includes(tag));
        if (commonTags.length > 0) {
          score += commonTags.length * 5;
          reasons.push(`${commonTags.length} common DNA tags`);
        }

        return { 
          artist: target, 
          score, 
          reason: reasons.join(', ') || 'General similarity' 
        };
      })
      .filter(m => m.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(({ artist, reason }) => ({ artist, reason }));
  }, [rawArtists]);

  const markAsConverted = useCallback(async (artistId: string) => {
    if (!user) return;
    const a = rawArtists.find(artist => artist.id === artistId);
    if (!a) return;

    const newOrderCount = (a.orderCount || 0) + 1;
    const newTier = newOrderCount >= 2 ? 'loyal' : 'new';
    
    toast.success(`Artist ${a.username} marked as Customer!`, {
      description: newOrderCount >= 2 ? "Tier upgraded to Loyal Customer!" : "New Customer added."
    });

    await updateArtist(artistId, { 
      stage: 'customers', 
      status: 'ordered',
      orderCount: newOrderCount,
      customerTier: newTier,
      lastOrderDate: new Date().toISOString()
    });
  }, [user, rawArtists, updateArtist]);

  const submitFeedback = useCallback((artistId: string, type: 'success' | 'failure') => {
    const artist = rawArtists.find(a => a.id === artistId);
    if (!artist) return;

    const tags = [artist.style, artist.location, artist.activityLevel].filter(Boolean) as string[];
    const multiplier = type === 'success' ? 1.05 : 0.95;

    setGlobalWeights(prev => {
      const next = { ...prev };
      tags.forEach(tag => {
        next[tag] = (next[tag] || 1.0) * multiplier;
      });
      return next;
    });

    if (type === 'success') {
      markAsConverted(artistId);
      toast.success('Success Feedback Captured!', {
        description: `Weights for ${tags.join(', ')} increased by 5%. System evolving...`
      });
    } else {
      updateArtist(artistId, { stage: 'dormant', status: 'dormant' });
      toast.error('Failure Feedback Captured', {
        description: `Weights for ${tags.join(', ')} decreased by 5%. Targeting refined.`
      });
    }
  }, [rawArtists, markAsConverted, updateArtist]);

  const importCSV = useCallback(async (data: any[], defaultLocation?: string, accountTag: string = 'default') => {
    if (!user) return;
    try {
      setIsScanning(true);
      setScanProgress({ current: 0, total: data.length });
      toast.info(`Importing ${data.length} leads. Initializing database...`, { id: 'import-progress' });
      
      const clean = (val: any) => {
        if (typeof val !== 'string') return val;
        return val.replace(/\uFFFD/g, '').trim();
      };

      // 1. Fast ID Lookup Map - Use Ref to avoid dependency on rawArtists
      const artistMap = new Map<string, CRMArtist>();
      const phoneMap = new Map<string, CRMArtist>();
      const nameMap = new Map<string, CRMArtist>();
      
      console.log(`Starting import of ${data.length} leads...`);
      rawArtistsRef.current.forEach(a => {
        if (a.id) artistMap.set(a.id, a);
        if (a.phone) phoneMap.set(a.phone.replace(/\D/g, ''), a);
        // Avoid matching on generic names like "Unknown Shop"
        if (a.shopName && a.shopName.toLowerCase().trim() !== 'unknown shop') {
          nameMap.set(a.shopName.toLowerCase().trim(), a);
        }
      });
      const allArtistsToSave: CRMArtist[] = [];
      const artistsToEnrich: CRMArtist[] = [];

      // 2. Fast Mapping (O(M))
      console.log("Mapping rows...");
      data.forEach((row, index) => {
        try {
          const shopName = clean(row.name || row.title || row.shopName || 'Unknown Shop');
          const mapsRating = parseFloat(row.rating || row.mapsRating || row.avg_rating) || 0;
          const phone = clean((row.phone || row.phone_number || '').toString().replace(/\D/g, ''));
          const email = clean(row.email || row.contact_email || '');
          
          let username = clean(row.ig_handle || row.igLink || row.instagram || row.instagram_url || row.ig_url || `user_${index}_${Date.now()}`);
          if (typeof username === 'string') {
            if (username.startsWith('@')) username = username.substring(1);
            if (username.includes('instagram.com/')) {
              username = username.split('instagram.com/')[1].split('/')[0].split('?')[0];
            }
            // Final cleanup for username
            username = username.replace(/[^\w@.]/g, '');
          } else {
            username = `user_${index}_${Date.now()}`;
          }

          const location = clean(row.location || row.location_tag || row.city || row.state || defaultLocation || 'Unknown');
          const country = clean(row.country || row.nation || 'USA');
          const followers = parseInt(row.followers || row.follower_count || row.followers_count) || 0;
          const address = row.address || row.full_address || row.formatted_address || '';
          
          // Try to find a stable ID from common scraper fields
          const placeId = row.place_id || row.cid || (row.metadata && (row.metadata.place_id || row.metadata.cid));
          const safeShopName = shopName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
          const safeLoc = (address || location).toLowerCase().replace(/[^a-z0-9]+/g, '_');
          
          // Make stableId more unique if placeId is missing
          let stableId = placeId;
          if (!stableId) {
            const uniqueSuffix = phone || email || `idx_${index}`;
            stableId = `shop_${safeShopName}_${safeLoc}_${uniqueSuffix}`;
          }

          // Check if already exists (by ID, Phone, or Name)
          // Only match by name if it's not a generic "Unknown Shop"
          const existingByName = (shopName.toLowerCase().trim() !== 'unknown shop') ? nameMap.get(shopName.toLowerCase().trim()) : null;
          const existing = artistMap.get(stableId) || (phone ? phoneMap.get(phone) : null) || existingByName;
          
          // Smart Skip: If data is identical to existing, don't write to save quota
          if (existing) {
            const isIdentical = 
              existing.shopName === shopName &&
              existing.phone === phone &&
              existing.email === (email || existing.email) &&
              existing.address === (address || existing.address) &&
              existing.mapsRating === mapsRating;
            
            if (isIdentical && !row.forceUpdate) {
              return; // Skip writing to save quota
            }
          }

          const artist: CRMArtist = {
            id: existing?.id || stableId,
            username: username || existing?.username,
            fullName: shopName || existing?.fullName,
            profilePic: existing?.profilePic || `https://picsum.photos/seed/shop${index}/100/100`,
            stage: existing?.stage || 'outreach',
            heatScore: existing?.heatScore || 0,
            similarityScore: existing?.similarityScore || 0,
            dnaTags: existing?.dnaTags || ['#TattooArtist', '#Professional'],
            lastInteractionDate: existing?.lastInteractionDate || new Date().toISOString(),
            orderCount: existing?.orderCount || 0,
            totalSpent: existing?.totalSpent || 0,
            totalItems: existing?.totalItems || 0,
            lastOrderDate: existing?.lastOrderDate,
            styleMatch: existing?.styleMatch || false,
            storyViews24h: existing?.storyViews24h || 0,
            isHighIntent: existing?.isHighIntent || false,
            hasFollowedBack: existing?.hasFollowedBack || false,
            replyCount: existing?.replyCount || 0,
            likeCount: existing?.likeCount || 0,
            ig_handle: username.startsWith('user_') ? null : username,
            followers: followers || existing?.followers || 0,
            style: existing?.style || 'Various',
            country: country || existing?.country || 'USA',
            shopName,
            mapsRating,
            address: address || existing?.address,
            location,
            baseScore: Math.floor(mapsRating * 20),
            similarityWeight: 0,
            facebookId: row.facebook_id || row.facebook || existing?.facebookId || null,
            phone: phone || existing?.phone || null,
            website: row.website || row.site || existing?.website || null,
            email: row.email || existing?.email || null,
            rating: mapsRating,
            metadata: { ...(existing?.metadata || {}), ...(row.metadata || {}), ...(row.place_id ? { place_id: row.place_id } : {}) },
            account_tag: accountTag || existing?.account_tag || 'default',
            uid: user.uid
          };

          allArtistsToSave.push(artist);
          if (!artist.followers || artist.style === 'Various') {
            artistsToEnrich.push(artist);
          }
        } catch (err) {
          console.error("Error mapping row:", row, err);
        }
      });

      console.log(`Mapped ${allArtistsToSave.length} unique artists from ${data.length} rows. Saving to Local Storage...`);

      if (allArtistsToSave.length === 0) {
        toast.success("All leads are already up-to-date. No changes needed.", { id: 'import-progress' });
        setIsScanning(false);
        setScanProgress({ current: 0, total: 0 });
        return;
      }
      
      // 3. Save to Local Storage IMMEDIATELY (Fast & Free)
      setScanProgress({ current: 0, total: allArtistsToSave.length });
      toast.info(`Saving ${allArtistsToSave.length} leads to local database...`, { id: 'import-progress' });

      const updatedArtists = [...rawArtistsRef.current];
      const newIds = new Set(allArtistsToSave.map(a => a.id));
      
      allArtistsToSave.forEach((newItem) => {
        const existingIdx = updatedArtists.findIndex(a => a.id === newItem.id);
        if (existingIdx >= 0) {
          updatedArtists[existingIdx] = { ...updatedArtists[existingIdx], ...newItem };
        } else {
          updatedArtists.push(newItem);
        }
      });
      
      // CRITICAL: Update state and cache BEFORE cloud sync
      lastLocalUpdateRef.current = Date.now();
      await localforage.setItem(`artists_${user.uid}`, updatedArtists);
      setRawArtists(updatedArtists);
      
      toast.success(`Locally saved ${allArtistsToSave.length} leads!`, { 
        id: 'import-progress',
        description: "Data is safe in your browser. Syncing with cloud..."
      });

      // 4. Bulk Sync to Firestore (Batches of 500)
      setScanProgress({ current: 0, total: allArtistsToSave.length });
      
      const FIRESTORE_BATCH_LIMIT = 500;
      let quotaHit = false;

      for (let i = 0; i < allArtistsToSave.length; i += FIRESTORE_BATCH_LIMIT) {
        if (quotaHit) break;

        const chunk = allArtistsToSave.slice(i, i + FIRESTORE_BATCH_LIMIT);
        const batch = writeBatch(db);
        
        chunk.forEach(artist => {
          if (artist.id) {
            batch.set(doc(db, 'artists', artist.id), sanitizeForFirestore({ ...artist, uid: user.uid }), { merge: true });
          }
        });
        
        try {
          console.log(`Committing cloud batch ${i / FIRESTORE_BATCH_LIMIT + 1}...`);
          // Use a longer timeout for large imports
          const commitPromise = batch.commit();
          const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), 30000));
          
          await Promise.race([commitPromise, timeoutPromise]);
          
          setScanProgress({ current: i + chunk.length, total: allArtistsToSave.length });
        } catch (commitErr: any) {
          console.error("Batch commit failed:", commitErr);
          const message = commitErr?.message || String(commitErr);
          
          if (message.includes("resource-exhausted") || message.includes("Quota exceeded") || message === "TIMEOUT") {
            quotaHit = true;
            toast.warning(message === "TIMEOUT" ? "Cloud Sync is slow" : "Cloud Quota Hit", {
              description: "Data is safe LOCALLY. Cloud backup will continue in background.",
              duration: 8000
            });
            break;
          }
        }
        
        // Small delay between batches to avoid overwhelming the connection
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      if (!quotaHit) {
        toast.success(`Cloud sync complete!`, { id: 'import-progress' });
      }

      // 5. Neon DB Sync (non-blocking — batch insert to PostgreSQL)
      try {
        const neonRes = await fetch('/api/artists/bulk-import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rows: allArtistsToSave,
            importRegion: defaultLocation || undefined,
            defaultCountry: 'USA',
          }),
        });
        const neonJson = await neonRes.json();
        if (neonJson.ok) {
          console.log(`Neon synced: ${neonJson.inserted} new, ${neonJson.updated} updated`);
        } else {
          console.warn('Neon sync returned error:', neonJson.error);
        }
      } catch (neonErr: any) {
        console.warn('Neon sync failed (non-blocking):', neonErr?.message);
      }

      // 6. Background AI Enrichment (Non-blocking)
      if (artistsToEnrich.length > 0) {
        // We don't await this, it runs in the background
        setTimeout(() => {
          processBackgroundAIEnrichment(artistsToEnrich, user.uid);
        }, 1000);
      }
    } catch (err: any) {
      console.error("Import CSV Failed:", err);
      if (err?.message === "QUOTA_EXCEEDED") {
        // Already handled with a specific toast
      } else {
        toast.error("Import failed. Check console for details.", { id: 'import-progress' });
      }
    } finally {
      setIsScanning(false);
      setScanProgress({ current: 0, total: 0 });
    }
  }, [user]);

  const processBackgroundAIEnrichment = async (artists: CRMArtist[], uid: string) => {
    console.log(`Starting background AI enrichment for ${artists.length} artists...`);
    const BATCH_SIZE = 50;
    const CONCURRENT_BATCHES = 2;

    for (let i = 0; i < artists.length; i += BATCH_SIZE * CONCURRENT_BATCHES) {
      if (!isScanningRef.current) break; // Allow stopping
      
      const promises = [];
      for (let j = 0; j < CONCURRENT_BATCHES; j++) {
        const start = i + (j * BATCH_SIZE);
        if (start >= artists.length) break;
        
        const chunk = artists.slice(start, start + BATCH_SIZE);
        promises.push((async () => {
          try {
            const aiData = await processArtistBatchAI(
              chunk.map(a => ({ 
                id: a.id, 
                username: a.username, 
                shopName: a.shopName,
                bio: `Professional tattoo artist at ${a.shopName}.`
              })),
              true
            );

            if (Object.keys(aiData).length > 0) {
              const batch = writeBatch(db);
              const localUpdates: CRMArtist[] = [];

              chunk.forEach(a => {
                const enriched = aiData[a.id];
                if (enriched) {
                  const updateData = {
                    followers: enriched.followers,
                    activityLevel: enriched.activityLevel,
                    style: enriched.style,
                    dnaTags: enriched.dnaTags || a.dnaTags,
                    username: enriched.realUsername || a.username,
                    fullName: enriched.realFullName || a.fullName,
                    uid: user.uid
                  };
                  batch.set(doc(db, 'artists', a.id), sanitizeForFirestore(updateData), { merge: true });
                  localUpdates.push({ ...a, ...updateData });
                }
              });
              await batch.commit();

              setRawArtists(prev => {
                const next = [...prev];
                localUpdates.forEach(update => {
                  const idx = next.findIndex(a => a.id === update.id);
                  if (idx >= 0) next[idx] = update;
                });
                return next;
              });
            }
          } catch (e) {
            console.error("AI Enrichment batch failed:", e);
          } finally {
            // Update progress even if failed to keep UI accurate
            setScanProgress(prev => ({ ...prev, current: Math.min(prev.current + chunk.length, artists.length) }));
          }
        })());
      }
      await Promise.all(promises);
    }
    setIsScanning(false);
    toast.success("Deep Scan Complete", {
      description: `Successfully analyzed ${artists.length} artists.`
    });
  };

  const syncShopifySales = useCallback(async (data: any[], accountTag?: string) => {
    if (!user) {
      toast.error("Please log in to sync Shopify data.");
      return;
    }

    setIsScanning(true);
    const totalRecords = data.length;
    setScanProgress({ current: 0, total: totalRecords });
    toast.info(`Processing ${totalRecords} Shopify records...`, { id: 'shopify-sync' });

    let matchCount = 0;
    let newCount = 0;
    const artistsToSave: CRMArtist[] = [];
    
    // Create lookup maps for O(1) matching from current state
    const emailMap = new Map<string, CRMArtist>();
    const phoneMap = new Map<string, CRMArtist>();
    const nameMap = new Map<string, CRMArtist>();

    rawArtistsRef.current.forEach(a => {
      if (accountTag && a.account_tag !== accountTag) return;
      if (a.email) emailMap.set(a.email.toLowerCase().trim(), a);
      if (a.phone) phoneMap.set(a.phone.replace(/\D/g, ''), a);
      if (a.shopName) nameMap.set(a.shopName.toLowerCase().trim(), a);
    });

    data.forEach(order => {
      const getVal = (keys: string[]) => {
        const foundKey = Object.keys(order).find(k => keys.some(target => k.toLowerCase().trim() === target.toLowerCase()));
        return foundKey ? (order[foundKey] || '').toString().trim() : '';
      };

      const email = getVal(['Email']).toLowerCase();
      const phone = getVal(['Phone', 'Default Address Phone']).replace(/\D/g, '');
      const firstName = getVal(['First Name']);
      const lastName = getVal(['Last Name']);
      const company = getVal(['Default Address Company', 'Company']);
      const fullName = company || `${firstName} ${lastName}`.trim() || 'Shopify Customer';
      const totalOrders = parseInt(getVal(['Total Orders'])) || 1;
      const totalSpent = parseFloat(getVal(['Total Spent'])) || 0;
      const totalItems = parseInt(getVal(['Total Items', 'Lineitem quantity'])) || 0;

      const province = getVal(['Default Address Province Code', 'Province Code']);
      const country = getVal(['Default Address Country Code', 'Country Code']);
      const location = (country && country !== 'US') ? country : (province || 'Unknown');

      // Try to find existing artist
      let artist = emailMap.get(email) || phoneMap.get(phone) || nameMap.get(fullName.toLowerCase());

      if (artist) {
        // Update existing
        const updatedArtist = {
          ...artist,
          stage: 'customers',
          orderCount: (artist.orderCount || 0) + totalOrders,
          totalSpent: (artist.totalSpent || 0) + totalSpent,
          totalItems: (artist.totalItems || 0) + totalItems,
          lastOrderDate: new Date().toISOString(),
          customerTier: ((artist.orderCount || 0) + totalOrders) >= 2 ? 'loyal' : 'new',
          dnaTags: [...new Set([...(artist.dnaTags || []), '#ShopifyCustomer', '#Purchased'])]
        } as CRMArtist;
        
        artistsToSave.push(updatedArtist);
        matchCount++;
      } else {
        // Create new
        const newArtist: CRMArtist = {
          id: `shopify_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          username: email.split('@')[0] || `user_${Math.random().toString(36).substr(2, 5)}`,
          fullName: fullName,
          profilePic: `https://picsum.photos/seed/${email || fullName}/100/100`,
          shopName: company || fullName,
          email: email,
          phone: phone,
          location: location,
          address: `${getVal(['Default Address Address1', 'Address1'])} ${getVal(['Default Address City', 'City'])}, ${province || ''} ${country || ''}`.trim(),
          stage: 'customers',
          heatScore: 50,
          similarityScore: 0,
          dnaTags: ['#ShopifyCustomer'],
          lastInteractionDate: new Date().toISOString(),
          orderCount: totalOrders,
          totalSpent: totalSpent,
          totalItems: totalItems,
          lastOrderDate: new Date().toISOString(),
          styleMatch: false,
          storyViews24h: 0,
          isHighIntent: false,
          hasFollowedBack: false,
          replyCount: 0,
          likeCount: 0,
          customerTier: totalOrders >= 2 ? 'loyal' : 'new',
          account_tag: accountTag || 'default'
        };
        artistsToSave.push(newArtist);
        newCount++;
      }
    });

    if (artistsToSave.length > 0) {
      // 1. Save Locally First
      toast.info(`Saving ${artistsToSave.length} Shopify matches to local database...`, { id: 'shopify-sync' });
      
      const updatedArtists = [...rawArtistsRef.current];
      artistsToSave.forEach(newItem => {
        const existingIdx = updatedArtists.findIndex(a => a.id === newItem.id);
        if (existingIdx >= 0) {
          updatedArtists[existingIdx] = { ...updatedArtists[existingIdx], ...newItem };
        } else {
          updatedArtists.push(newItem);
        }
      });

      await localforage.setItem(`artists_${user.uid}`, updatedArtists);
      setRawArtists(updatedArtists);
      
      toast.success(`Locally synced ${artistsToSave.length} Shopify records!`, { 
        id: 'shopify-sync',
        description: `Matched: ${matchCount} | New: ${newCount}. Cloud sync in progress...`
      });

      // 2. Background Cloud Sync
      setScanProgress({ current: 0, total: artistsToSave.length });
      const FIRESTORE_BATCH_LIMIT = 200; // Smaller batches for more frequent progress updates
      let quotaHit = false;

      for (let i = 0; i < artistsToSave.length; i += FIRESTORE_BATCH_LIMIT) {
        if (quotaHit) break;
        
        const batch = writeBatch(db);
        const chunk = artistsToSave.slice(i, i + FIRESTORE_BATCH_LIMIT);
        chunk.forEach(artist => {
          batch.set(doc(db, 'artists', artist.id), sanitizeForFirestore({ ...artist, uid: user.uid }), { merge: true });
        });

        try {
          console.log(`Committing Shopify cloud batch ${i / FIRESTORE_BATCH_LIMIT + 1}...`);
          // Use a longer timeout for large imports (120s)
          const commitPromise = batch.commit();
          const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), 120000));
          
          await Promise.race([commitPromise, timeoutPromise]);
          
          setScanProgress(prev => ({ ...prev, current: Math.min(i + chunk.length, artistsToSave.length) }));
        } catch (err: any) {
          console.error("Shopify Batch commit failed:", err);
          const message = err?.message || String(err);

          if (message.includes("resource-exhausted") || message.includes("Quota exceeded") || message === "TIMEOUT") {
            quotaHit = true;
            toast.warning(message === "TIMEOUT" ? "Cloud Sync is slow" : "Cloud Quota Hit", {
              description: "Data is saved LOCALLY. Cloud backup will resume automatically.",
              duration: 8000
            });
            break;
          }
        }
      }

      if (!quotaHit) {
        toast.success("Shopify Cloud Sync Complete!", { id: 'shopify-sync' });
      }

      const firstMatch = artistsToSave.find(a => a.stage === 'customers');
      if (firstMatch) {
        markAsConverted(firstMatch.id);
      }
    } else {
      toast.error("No valid data found in Shopify CSV.", { id: 'shopify-sync' });
    }

    setIsScanning(false);
  }, [user, markAsConverted]);

  const bulkEnrichArtists = useCallback(async () => {
    const outreachArtists = rawArtists.filter(a => a.stage === 'outreach');
    const targets = outreachArtists.filter(a => !a.followers || !a.style);
    const skipped = outreachArtists.length - targets.length;

    if (targets.length === 0) {
      toast.success("All outreach leads already have enriched data!");
      return;
    }

    if (skipped > 0) {
      toast.info(`Deep Scanning ${targets.length} leads. Skipping ${skipped} already enriched.`, { id: 'enrich-progress' });
    } else {
      toast.info(`Deep Scanning ${targets.length} artists for Instagram data...`, { id: 'enrich-progress' });
    }

    setIsScanning(true);
    setScanProgress({ current: 0, total: targets.length });

    const BATCH_SIZE = 20; // Smaller batches for more frequent updates
    const CONCURRENT_BATCHES = 3;
    let completedCount = 0;

    for (let i = 0; i < targets.length; i += BATCH_SIZE * CONCURRENT_BATCHES) {
      if (!isScanningRef.current) {
        console.log("Stopping bulk enrichment...");
        break;
      }
      const batchPromises = [];
      
      for (let j = 0; j < CONCURRENT_BATCHES; j++) {
        const start = i + (j * BATCH_SIZE);
        if (start >= targets.length) break;
        
        const batchToEnrich = targets.slice(start, start + BATCH_SIZE);
        
        const processBatch = async () => {
          try {
            const aiData = await processArtistBatchAI(
              batchToEnrich.map(a => ({ id: a.id, username: a.username, shopName: a.shopName })),
              true
            );

            if (Object.keys(aiData).length > 0) {
              const updateBatch = writeBatch(db);
              const localUpdates: CRMArtist[] = [];

              batchToEnrich.forEach(a => {
                const enriched = aiData[a.id];
                if (enriched) {
                  const updates = {
                    username: enriched.realUsername || a.username,
                    fullName: enriched.realFullName || a.fullName,
                    followers: enriched.followers,
                    activityLevel: enriched.activityLevel,
                    style: enriched.style,
                    dnaTags: [...new Set([...(a.dnaTags || []), ...(enriched.dnaTags || [])])],
                    uid: user.uid // Ensure UID is present
                  };
                  // Use set with merge: true to handle documents that might be missing UID
                  updateBatch.set(doc(db, 'artists', a.id), sanitizeForFirestore(updates), { merge: true });
                  localUpdates.push({ ...a, ...updates });
                }
              });
              await updateBatch.commit();

              // Update local state for immediate feedback
              setRawArtists(prev => {
                const next = [...prev];
                localUpdates.forEach(update => {
                  const idx = next.findIndex(a => a.id === update.id);
                  if (idx >= 0) next[idx] = update;
                });
                return next;
              });
            }
          } catch (e) {
            console.error("Enrichment batch failed", e);
          } finally {
            completedCount += batchToEnrich.length;
            setScanProgress(prev => ({ ...prev, current: Math.min(completedCount, targets.length) }));
          }
        };
        batchPromises.push(processBatch());
      }

      await Promise.all(batchPromises);
      toast.info(`Enrichment Progress: ${Math.min(completedCount, targets.length)} / ${targets.length}...`, { id: 'enrich-progress' });
      
      if (i + BATCH_SIZE * CONCURRENT_BATCHES < targets.length) {
        await new Promise(resolve => setTimeout(resolve, 800));
      }
    }

    setIsScanning(false);
    setScanProgress({ current: 0, total: 0 });
    toast.success(`Successfully enriched ${targets.length} artists with AI data!`, { id: 'enrich-progress' });
  }, [user, rawArtists]);

  // Automation Orchestration Logic
  const assignTaskToAccount = useCallback(async (artistId: string): Promise<string | null> => {
    if (!user) return null;

    // 1. Check if artist is already assigned in the last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const existingAssignment = assignments.find(a => 
      a.artistId === artistId && 
      new Date(a.assignedAt) > sevenDaysAgo
    );

    if (existingAssignment) {
      toast.error('Artist already assigned to an account within the last 7 days.');
      return existingAssignment.accountId;
    }

    // 2. Find an available account (idle and not at daily limit)
    const availableAccount = accounts.find(acc => 
      acc.status === 'idle' && 
      acc.dailyActionCount < 50 // Mock limit
    );

    if (!availableAccount) {
      toast.error('No available Instagram accounts found.');
      return null;
    }

    // 3. Create assignment
    const newAssignment: TaskAssignment = {
      id: crypto.randomUUID(),
      artistId,
      accountId: availableAccount.id,
      assignedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'pending'
    };

    try {
      const assignmentRef = doc(db, 'assignments', newAssignment.id);
      await setDoc(assignmentRef, sanitizeForFirestore({ ...newAssignment, uid: user.uid }));
      toast.success(`Task assigned to @${availableAccount.username}`);
      return availableAccount.id;
    } catch (error) {
      console.error('Assignment failed:', error);
      toast.error('Failed to assign task');
      return null;
    }
  }, [user, assignments, accounts]);

  const startAutomationSequence = useCallback(async (artistId: string, accountId: string) => {
    if (!user) return;

    const artist = rawArtists.find(a => a.id === artistId);
    const account = accounts.find(a => a.id === accountId);

    if (!artist || !account) return;

    // Humanization Profile Generation (Anti-Bot Logic)
    // Randomize working hours (e.g., 8-11 AM start, 6-10 PM end)
    const startHour = 8 + Math.floor(Math.random() * 4); 
    const endHour = 18 + Math.floor(Math.random() * 5);
    
    // Randomize session intensity
    const sessionLikes = 1 + Math.floor(Math.random() * 3);
    const sessionComments = Math.random() > 0.4 ? 1 : 0;
    const sessionFollows = Math.random() > 0.7 ? 1 : 0;

    // Timezone & Working Hours Awareness
    const currentHour = new Date().getHours(); 
    if (currentHour < startHour || currentHour > endHour) {
      toast.warning(`Outside of @${account.username}'s randomized daily window (${startHour}AM-${endHour-12}PM). Sequence queued for next active slot.`);
    }

    toast.info(`Starting humanized sequence for @${artist.username} using @${account.username}...`);

    try {
      const response = await fetch('/api/automation/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artistId,
          accountId,
          behaviorProfile: account.behaviorProfile,
          artistHandle: artist.username,
          accountHandle: account.username,
          humanization: {
            startHour,
            endHour,
            sessionLikes,
            sessionComments,
            sessionFollows,
            jitterRange: [45 + Math.floor(Math.random() * 30), 240 + Math.floor(Math.random() * 120)]
          }
        })
      });

      if (response.status === 403) {
        const text = await response.text();
        const data = safeJsonParse(text, {});
        toast.error(`Night Mode: @${account.username} is sleeping.`, {
          description: data.message || 'Account is in mandatory night-time sleep cycle.'
        });
        return;
      }

      if (response.status === 429) {
        const text = await response.text();
        const data = safeJsonParse(text, {});
        toast.warning(`Coffee Break: @${account.username} is resting.`, {
          description: data.message || 'Account is taking a natural break.'
        });
        return;
      }

      if (!response.ok) throw new Error('Failed to start automation');
      
      toast.success('Humanized automation sequence initiated.');
    } catch (error) {
      console.error('Automation error:', error);
      toast.error('Failed to start automation sequence.');
    }
  }, [user, rawArtists, accounts]);

  const clearAllData = useCallback(async () => {
    if (!user) return;
    try {
      const q = query(collection(db, 'artists'), where('uid', '==', user.uid));
      const snapshot = await getDocs(q);
      const batch = writeBatch(db);
      snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });
      await batch.commit();
      
      // Clear interactions too
      const qInt = query(collection(db, 'interactions'), where('uid', '==', user.uid));
      const snapInt = await getDocs(qInt);
      const batchInt = writeBatch(db);
      snapInt.docs.forEach((doc) => {
        batchInt.delete(doc.ref);
      });
      await batchInt.commit();

      setRawArtists([]);
      setInteractions([]);
      await localforage.removeItem(`artists_${user.uid}`);
      toast.success("All data cleared successfully.");
    } catch (e) {
      console.error("Failed to clear data", e);
      toast.error("Failed to clear cloud data");
    }
  }, [user]);

  const cleanupOldFirestoreData = useCallback(async () => {
    if (!user) return;
    try {
      toast.info("Fetching current data from server...", { id: 'cleanup-fs' });

      // 1. Get all Neon IDs
      const neonRes = await fetch('/api/artists');
      if (!neonRes.ok) throw new Error('Failed to fetch Neon data');
      const neonData = await neonRes.json();
      const neonIds = new Set(neonData.map((r: any) => String(r.id || r.uid)));

      // 2. Scan Firestore artists
      const fsSnap = await getDocs(collection(db, 'artists'));
      const toDelete: any[] = [];

      for (const doc of fsSnap.docs) {
        const data = doc.data();
        const docId = data?.id ? String(data.id) : doc.id;
        if (!neonIds.has(docId)) {
          toDelete.push(doc.ref);
        }
      }

      // 3. Also clear other collections
      const otherCollections = ['interactions', 'orders', 'accounts', 'assignments'];
      for (const colName of otherCollections) {
        const colSnap = await getDocs(collection(db, colName));
        colSnap.docs.forEach(d => toDelete.push(d.ref));
      }

      if (toDelete.length === 0) {
        toast.success('No stale Firestore data found!', { id: 'cleanup-fs' });
        return;
      }

      toast.info(`Deleting ${toDelete.length} stale documents...`, { id: 'cleanup-fs' });

      // 4. Batch delete (500 at a time)
      const BATCH_LIMIT = 500;
      for (let i = 0; i < toDelete.length; i += BATCH_LIMIT) {
        const chunk = toDelete.slice(i, i + BATCH_LIMIT);
        const batch = writeBatch(db);
        chunk.forEach(ref => batch.delete(ref));
        await batch.commit();
      }

      toast.success(`Cleaned up ${toDelete.length} stale documents!`, { id: 'cleanup-fs' });
    } catch (e) {
      console.error("Failed to clean up Firestore", e);
      toast.error("Failed to clean up old Firestore data", { id: 'cleanup-fs' });
    }
  }, [user]);

  const markAsIdealTarget = useCallback(async (artistId: string) => {
    if (!user) return;
    const target = rawArtists.find(a => a.id === artistId);
    if (!target) return;

    setIsScanning(true);
    setScanProgress({ current: 0, total: rawArtists.length });
    toast.info(`Performing weighted global scan based on @${target.username}'s feature vector...`);

    const updatedArtists = rawArtists.map(a => {
      if (a.stage !== 'outreach') return a;
      
      let weightedMatch = 0;
      let totalPossibleWeight = 0;
      
      target.dnaTags.forEach(tag => {
        const weight = globalWeights[tag] || 1.0;
        totalPossibleWeight += weight;
        if (a.dnaTags.includes(tag)) {
          weightedMatch += weight;
        }
      });
      
      const similarityWeight = (weightedMatch / Math.max(0.1, totalPossibleWeight)) * 100;
      const isRecommended = similarityWeight >= 60;
      const similarityScore = Math.min(100, (a.similarityScore || 0) + (similarityWeight * 0.2));

      return { 
        ...a, 
        similarityWeight, 
        isRecommended,
        similarityScore
      };
    });

    try {
      const FIRESTORE_BATCH_SIZE = 500;
      for (let i = 0; i < updatedArtists.length; i += FIRESTORE_BATCH_SIZE) {
        const batch = writeBatch(db);
        const chunk = updatedArtists.slice(i, i + FIRESTORE_BATCH_SIZE);
        chunk.forEach(artist => {
          const docRef = doc(db, 'artists', artist.id);
          batch.set(docRef, sanitizeForFirestore({ ...artist, uid: user.uid }));
        });
        await batch.commit();
        setScanProgress({ current: Math.min(i + FIRESTORE_BATCH_SIZE, updatedArtists.length), total: updatedArtists.length });
      }

      const recommended = updatedArtists.filter(a => a.stage === 'outreach' && a.isRecommended).length;
      setPinnedCount(recommended);
      
      toast.success('Weighted scan complete', {
        description: `Prioritized "Winners" based on learned feature weights.`
      });
    } catch (e) {
      console.error("Failed to save scan results", e);
      toast.error("Failed to persist scan results to cloud");
    } finally {
      setIsScanning(false);
    }
  }, [user, rawArtists, globalWeights]);

  const simulateInteraction = useCallback(async (artistId: string, points: number) => {
    if (!user) return;
    
    setRawArtists(prev => {
      const artist = prev.find(a => a.id === artistId);
      if (!artist) return prev;
      
      const oldScore = artist.heatScore || 0;
      const newScore = Math.min(100, oldScore + points);
      const isHighIntent = newScore >= 80;
      
      let newStage = artist.stage;
      if (newScore >= 80 && oldScore < 80) {
        newStage = 'engaged';
        toast.success("🔥 High-Value Lead Detected!", {
          description: `@${artist.username} has reached high-intent threshold. Moving to Engaged stage.`,
          duration: 5000,
        });
      }
      
      const updatedItem = { ...artist, heatScore: newScore, isHighIntent, stage: newStage };
      const updatedList = prev.map(a => a.id === artistId ? updatedItem : a);
      localforage.setItem(`artists_${user.uid}`, updatedList);
      
      // Sync to cloud
      const docRef = doc(db, 'artists', artistId);
      setDoc(docRef, sanitizeForFirestore({ heatScore: newScore, isHighIntent, stage: newStage }), { merge: true });
      
      return updatedList;
    });
  }, [user]);

  const seedTestData = useCallback(async () => {
    if (!user) return;
    
    const testArtists: CRMArtist[] = [
      {
        id: `test_1`,
        username: 'ink_master_test',
        fullName: 'Test Artist 1',
        profilePic: 'https://picsum.photos/seed/test1/100/100',
        stage: 'outreach',
        heatScore: 10,
        likeCount: 2,
        similarityScore: 85,
        dnaTags: ['Realism', 'Black & Grey'],
        lastInteractionDate: new Date().toISOString(),
        orderCount: 0,
        uid: user.uid
      },
      {
        id: `test_2`,
        username: 'color_king',
        fullName: 'Test Artist 2',
        profilePic: 'https://picsum.photos/seed/test2/100/100',
        stage: 'outreach',
        heatScore: 85,
        likeCount: 5,
        replyCount: 3,
        hasFollowedBack: true,
        similarityScore: 40,
        dnaTags: ['Traditional', 'Neo-Traditional'],
        lastInteractionDate: new Date().toISOString(),
        orderCount: 0,
        uid: user.uid
      },
      {
        id: `test_3`,
        username: 'linework_pro',
        fullName: 'Test Artist 3',
        profilePic: 'https://picsum.photos/seed/test3/100/100',
        stage: 'outreach',
        heatScore: 5,
        likeCount: 1,
        similarityScore: 95,
        dnaTags: ['Fine Line', 'Minimalist'],
        lastInteractionDate: new Date().toISOString(),
        orderCount: 0,
        uid: user.uid
      },
      {
        id: `test_4`,
        username: 'dark_art_tattoo',
        fullName: 'Test Artist 4',
        profilePic: 'https://picsum.photos/seed/test4/100/100',
        stage: 'outreach',
        heatScore: 90,
        similarityScore: 20,
        dnaTags: ['Blackwork', 'Dark Art'],
        lastInteractionDate: new Date().toISOString(),
        orderCount: 0,
        uid: user.uid
      },
      {
        id: `test_5`,
        username: 'geometric_ink',
        fullName: 'Test Artist 5',
        profilePic: 'https://picsum.photos/seed/test5/100/100',
        stage: 'outreach',
        heatScore: 45,
        similarityScore: 65,
        dnaTags: ['Geometric', 'Dotwork'],
        lastInteractionDate: new Date().toISOString(),
        orderCount: 0,
        uid: user.uid
      }
    ];
    
    setRawArtists(prev => {
      const mergedMap = new Map<string, CRMArtist>();
      // Build a map of existing artists by username for lookup
      const existingByUsername = new Map<string, CRMArtist>();
      prev.forEach(a => {
        mergedMap.set(a.id, a);
        if (a.username) existingByUsername.set(a.username.toLowerCase(), a);
      });

      const finalTestArtists = testArtists.map(ta => {
        const existing = existingByUsername.get(ta.username.toLowerCase());
        if (existing) {
          return { ...existing, ...ta, id: existing.id }; // Reuse existing ID
        }
        return ta;
      });

      finalTestArtists.forEach(a => mergedMap.set(a.id, a));
      
      const newList = Array.from(mergedMap.values());
      localforage.setItem(`artists_${user.uid}`, newList);
      
      // Sync to cloud
      finalTestArtists.forEach(a => {
        const docRef = doc(db, 'artists', a.id);
        setDoc(docRef, sanitizeForFirestore({ ...a, uid: user.uid }), { merge: true });
      });
      
      return newList;
    });
    
    toast.success("Test data seeded successfully", {
      description: "Added/Updated 5 dummy artists in your outreach list."
    });
  }, [user]);

  // Dormant logic is handled via useMemo in the artists derivation

  return (
    <CRMContext.Provider value={{ 
      artists, 
      interactions,
      orders,
      pagination,
      globalStats,
      accounts,
      assignments,
      assignTaskToAccount,
      startAutomationSequence,
      loadData,
      persona, 
      setPersona, 
      conversionDNA, 
      moveArtist, 
      updateArtist, 
      addInteraction, 
      addOrder,
      markAsConverted,
      analyzeArtistVisualDNA,
      findSimilarArtists,
      importCSV,
      syncShopifySales,
      bulkEnrichArtists,
      clearAllData,
      deleteArtist,
      cleanupOldFirestoreData,
      markAsIdealTarget,
      submitFeedback,
      refreshHarvestList,
      isScanning,
      setIsScanning,
      isRefreshing,
      scanProgress,
      pinnedCount,
      mockMode,
      setMockMode,
      debugMode,
      setDebugMode,
      simulateInteraction,
      seedTestData,
      globalWeights,
      harvestList,
      user,
      login,
      logout,
      isAuthReady
    }}>
      {children}
    </CRMContext.Provider>
  );
};

export const useCRM = () => {
  const context = useContext(CRMContext);
  if (!context) throw new Error('useCRM must be used within a CRMProvider');
  return context;
};
