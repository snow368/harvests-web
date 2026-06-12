
export type CRMStage = 'outreach' | 'engaged' | 'customers' | 'dormant';
export type AIPersona = 'professional' | 'friendly';

export interface CRMArtist {
  id: string;
  uid?: string; // Firebase User ID
  username: string;
  fullName: string;
  profilePic: string;
  stage: CRMStage;
  heatScore: number; // 0-100
  baseScore?: number; // Base score from maps/followers
  similarityScore: number; // 0-100
  similarityWeight?: number; // Weight for sorting
  dnaTags: string[];
  visualDNA?: {
    style: string;
    technical_details: string[];
    match_score: number;
    proportions?: Record<string, number>;
  };
  lastInteractionDate: string;
  orderCount: number;
  totalSpent?: number;
  totalItems?: number;
  lastOrderDate?: string;
  location_tag?: string;
  location?: string;
  address?: string;
  shopName?: string;
  phone?: string;
  email?: string;
  website?: string;
  ig_handle?: string;
  followers?: number;
  country?: string;
  activityLevel?: 'high' | 'medium' | 'low';
  style?: string;
  styleMatch?: boolean;
  storyViews24h?: number;
  isHighIntent?: boolean;
  hasFollowedBack?: boolean;
  replyCount?: number;
  likeCount?: number;
  mapsRating?: number;
  rating?: number;
  facebookId?: string;
  account_id?: string; // For multi-account tracking
  account_tag?: string;
  customerTier?: 'new' | 'loyal' | 'vip';
  metadata?: Record<string, any>;
}

export interface CRMInteraction {
  id: string;
  artistId: string;
  type: 'like' | 'comment' | 'follow' | 'story_view' | 'dm_reply' | 'follow_back' | 'reply';
  weight: number;
  timestamp: string;
  content?: string;
}

export interface CRMOrder {
  id: string;
  artistId: string;
  productName: string;
  amount: number;
  orderDate: string;
}

export type AccountBehavior = 'observer' | 'active' | 'warmup';

export interface InstagramAccount {
  id: string;
  username: string;
  proxyIp?: string;
  timezone?: string;
  behaviorProfile: AccountBehavior;
  status: 'idle' | 'running' | 'cooldown' | 'banned';
  lastActionAt?: string;
  dailyActionCount: number;
}

export interface TaskAssignment {
  id: string;
  artistId: string;
  accountId: string;
  assignedAt: string;
  expiresAt: string;
  status: 'pending' | 'completed' | 'failed';
}

export interface CRMState {
  artists: CRMArtist[];
  interactions: CRMInteraction[];
  orders: CRMOrder[];
  accounts: InstagramAccount[];
  assignments: TaskAssignment[];
  persona: AIPersona;
  globalWeights: Record<string, number>;
}
