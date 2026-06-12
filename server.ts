import express from 'express';
import { createServer as createViteServer } from 'vite';
import cors from 'cors';
import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import Papa from 'papaparse';
import { scrapeState } from './src/lib/scrape-engine.ts';
import { getBotProfile, getDailySpeedFactor } from '../engine/scripts/bot-profile.ts';
import { State } from 'country-state-city';
import dotenv from 'dotenv';
import { neon } from '@neondatabase/serverless';
import { spawn } from 'child_process';

// Simple wrapper for parse-order-notes
const parseNote = (note: string): any[] => {
  try {
    const m = note.match(/\b(\d{3,4})(RL|RS|RG|RT|F|M)\b/gi);
    const gifts: any[] = [];
    if (m) m.forEach((x: string) => gifts.push({ type: 'needle', label: x.toUpperCase(), quantity: 1, estimatedBoxes: 1 }));
    if (/小海报/i.test(note)) gifts.push({ type: 'poster', label: '小海报', quantity: 1 });
    return gifts;
  } catch { return []; }
};

dotenv.config();

const DATABASE_URL = process.env.NEON_DATABASE_URL;
if (!DATABASE_URL) {
  console.error('鉂?NEON_DATABASE_URL is not defined in .env');
  process.exit(1);
}
const sql = neon(DATABASE_URL);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GEONAMES_US_CACHE = path.join(__dirname, 'data', 'geonames_us_places_by_state.json');

type SocialPlatform = 'instagram' | 'facebook' | 'tiktok';

interface ShopLookupInput {
  id: string;
  shopName?: string;
  website?: string;
  address?: string;
  phone?: string;
}

interface DeepScanTask {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: 'running' | 'paused' | 'completed';
  total: number;
  batchSize: number;
  pendingIds: string[];
  leasedUntilById: Record<string, number>;
  completedIds: string[];
  failedIds: string[];
  failedReasonById: Record<string, string>;
  retryCountById: Record<string, number>;
  maxRetries: number;
}

interface DeepScanLease {
  taskId: string;
  artistIds: string[];
}

interface BotInstancePayload {
  botId: string;
  accountIds: string[];
  host?: string;
  ip?: string;
  version?: string;
  meta?: Record<string, any>;
}

interface BotScheduleConfig {
  enabled: boolean;
  pauseWindow: { start: string; end: string };
  resumeWindow: { start: string; end: string };
  resumeBotIds: string[];
}

interface BotScheduleState {
  date: string;
  pauseAt: number;
  resumeAt: number;
  pauseDone: boolean;
  resumeDone: boolean;
}

const TATTOO_INCLUDE_RE = /\b(tattoo|tattooing|tattoo\s*studio|tattoo\s*shop|tattoo\s*parlo[u]?r|ink|inked|blackwork|fineline|fine\s*line|realism|traditional|neo\s*traditional|irezumi|flash|custom\s*tattoo|cover\s*up|coverup|piercing|body\s*piercing|body\s*art)\b/i;
const NON_TATTOO_EXCLUDE_RE = /\b(wix|vision|optical|eyewear|eye\s*exam|law|attorney|legal\s*services|clinic|medical\s*spa|dental|dentist|orthodontic|church|ministry|school|academy|real\s*estate|mortgage|insurance|plumbing|hvac|electrician|roofing|bakery|cafe|coffee|restaurant|catering)\b/i;
const NON_TATTOO_HANDLE_RE = /^(wix|clairesstores|visionexpress|lovisajewellery)$/i;

const extractIgHandle = (raw: any): string => {
  const v = String(raw || '').trim();
  if (!v) return '';
  const m = v.match(/instagram\.com\/([a-zA-Z0-9._-]+)/i);
  if (m?.[1]) return m[1].toLowerCase();
  return v.replace(/^@/, '').toLowerCase();
};

const isLikelyTattooHandle = (raw: any): boolean => {
  const h = extractIgHandle(raw);
  if (!h) return false;
  if (NON_TATTOO_HANDLE_RE.test(h)) return false;
  // Broad match: tattoo/ink/pierc keywords OR looks like a personal art handle (contains "art", "ink", "tat", "tattoo" etc)
  if (/(shop|studio|tattoo|ink|irezumi|pierc|needle|tat2|tatto|art|tat_|_tat|_ink|ink_|tats_)/i.test(h)) return true;
  // Allow through if handle is reasonably long (likely not a random/squat handle) and artist passed isTattooEntity
  if (h.length >= 4 && !/^[0-9_]+$/.test(h)) return true;
  return false;
};

const isTattooEntity = (row: any): boolean => {
  const text = [
    row?.shop_name,
    row?.website,
    row?.address,
    row?.ig_handle
  ]
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (!text) return false;
  const hasInclude = TATTOO_INCLUDE_RE.test(text);
  const hasExclude = NON_TATTOO_EXCLUDE_RE.test(text);
  if (hasInclude) return true;
  if (hasExclude && !hasInclude) return false;
  return false;
};

const normalizeFailedReason = (raw?: string): string => {
  const reason = String(raw || '').trim().toLowerCase();
  if (!reason) return 'unknown';
  const allowed = new Set([
    'network',
    'timeout',
    'ai_empty',
    'social_lookup_empty',
    'social_lookup_error',
    'ai_error',
    'firestore_write',
    'unknown'
  ]);
  return allowed.has(reason) ? reason : 'unknown';
};

const SOCIAL_HOSTS: Record<SocialPlatform, string[]> = {
  instagram: ['instagram.com'],
  facebook: ['facebook.com', 'fb.com'],
  tiktok: ['tiktok.com']
};

// Skip non-user-profile social URLs
const SOCIAL_SKIP_PATHS: Record<string, string[]> = {
  instagram: ['/reels/', '/p/', '/reel/', '/explore/', '/accounts/', '/discover/',
    '/stories/', '/developer/', '/about/', '/legal/', '/privacy/', '/help/',
    '/meta/', '/ads/', '/business/', '/creator/', '/tv/', '/music/', '/locations/',
    '/share/', '/intent/', '/profilecard/'],
  facebook: ['/sharer/', '/plugins/', '/login/', '/privacy/', '/policies/', '/help/',
    '/share/', '/intent/', '/profile.php', '/groups/'],
  tiktok: ['/search/', '/explore/', '/business/', '/about/', '/ad/']
};

// Known platform/builder handles that are not real user accounts
const SOCIAL_SKIP_HANDLES = new Set([
  'instagram', 'meta', 'facebook', 'threads', 'gmail', 'outlook',
  'yahoo', 'hotmail', 'accounts', 'share', 'about', 'help', 'legal',
  'security', 'developer', 'blog', 'creators', 'business', 'shop',
  'settings', 'login', 'home', 'explore', 'discover', 'signup',
  'wix', 'squarespace', 'wordpress', 'godaddy', 'shopify', 'tiktok',
  'twitter', 'linkedin', 'youtube', 'pinterest', 'snapchat', 'profilecard', 'profile'
]);

const TEMPLATE_DOMAINS = ['wixsite.com', 'squarespace.com', 'myshopify.com', 'wordpress.com'];
const POWERED_BY_PATTERNS = ['powered by', 'built with', 'branding by', 'create your', 'make your own', 'website builder', 'template by', 'theme by'];

const fetchText = async (url: string, timeoutMs: number = 8000): Promise<string> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      }
    });
    if (!resp.ok) return '';
    return await resp.text();
  } catch {
    // Fallback: use curl if Node.js fetch fails (common on some Windows environments)
    try {
      const { execSync } = require('child_process');
      const safeUrl = url.replace(/"/g, '\\"');
      return execSync(`curl -s --max-time ${Math.ceil(timeoutMs / 1000)} -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0" "${safeUrl}"`, { timeout: timeoutMs + 2000, encoding: 'utf-8' });
    } catch { return ''; }
  } finally {
    clearTimeout(timer);
  }
};

const ensureHttp = (url?: string): string | null => {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  if (trimmed.includes('.')) return `https://${trimmed}`;
  return null;
};

const normalizeSocialUrl = (raw: string): string => {
  try {
    const u = new URL(raw);
    u.hash = '';
    u.search = '';
    return u.toString().replace(/\/+$/, '');
  } catch {
    return raw.trim();
  }
};

const isPoweredByContext = (html: string, url: string): boolean => {
  const idx = html.indexOf(url);
  if (idx === -1) return false;
  const before = html.slice(Math.max(0, idx - 300), idx).toLowerCase();
  return POWERED_BY_PATTERNS.some(p => before.includes(p));
};

const hasSkipPath = (url: string, platform: 'instagram' | 'facebook' | 'tiktok'): boolean => {
  const lower = url.toLowerCase();
  return SOCIAL_SKIP_PATHS[platform].some((p) => lower.includes(p));
};

const extractSocialHandle = (url: string, platform: 'instagram' | 'facebook' | 'tiktok'): string | null => {
  try {
    const u = new URL(url);
    const parts = u.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    return parts[0] || null;
  } catch {
    return null;
  }
};

const findSocialLinks = (text: string, checkPoweredBy = false): { instagram: string[]; facebook: string[]; tiktok: string[]; emails: string[]; whatsapp: string[] } => {
  const result = {
    instagram: [] as string[],
    facebook: [] as string[],
    tiktok: [] as string[],
    emails: [] as string[],
    whatsapp: [] as string[]
  };
  if (!text) return result;

  const socialRegex = /https?:\/\/[^\s"'<>]+/gi;
  const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  const waRegex = /(?:wa\.me\/\d+|whatsapp(?:\.com)?\/(?:send|channel)\/?[^\s"'<>]*)/gi;

  const urls = Array.from(new Set((text.match(socialRegex) || []).map(normalizeSocialUrl)));
  urls.forEach((url) => {
    const lower = url.toLowerCase();
    if (checkPoweredBy && isPoweredByContext(text, url)) return;
    if (SOCIAL_HOSTS.instagram.some((h) => lower.includes(h)) && !hasSkipPath(url, 'instagram')) result.instagram.push(url);
    if (SOCIAL_HOSTS.facebook.some((h) => lower.includes(h)) && !hasSkipPath(url, 'facebook')) result.facebook.push(url);
    if (SOCIAL_HOSTS.tiktok.some((h) => lower.includes(h)) && !hasSkipPath(url, 'tiktok')) result.tiktok.push(url);
  });

  result.emails = Array.from(new Set((text.match(emailRegex) || []).map((e) => e.trim().toLowerCase())));
  result.whatsapp = Array.from(new Set((text.match(waRegex) || []).map((w) => w.trim())));
  return result;
};

const pickBest = (links: string[], platform: 'instagram' | 'facebook' | 'tiktok' = 'instagram'): string | null => {
  if (!links || links.length === 0) return null;
  const filtered = links.filter((l) => {
    const lower = l.toLowerCase();
    if (lower.includes('/share') || lower.includes('/intent/')) return false;
    if (hasSkipPath(l, platform)) return false;
    const handle = extractSocialHandle(l, platform);
    if (handle && SOCIAL_SKIP_HANDLES.has(handle.toLowerCase())) return false;
    return true;
  });
  return filtered[0] ?? null;
};

const parseCsvRows = (text: string): { rows: Record<string, any>[]; headers: string[] } => {
  const parsed = Papa.parse<Record<string, any>>(text, {
    header: true,
    skipEmptyLines: true
  });
  const rows = Array.isArray(parsed.data) ? parsed.data : [];
  const headers = Array.isArray(parsed.meta?.fields) ? parsed.meta.fields.filter(Boolean) : [];
  return { rows, headers };
};

const scoreCandidate = (candidate: string | null, source: 'website' | 'search', shop: ShopLookupInput): number => {
  if (!candidate) return 0;
  let score = source === 'website' ? 0.78 : 0.58;
  const lower = candidate.toLowerCase();
  if (shop.shopName) {
    const key = shop.shopName.toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (key.length > 3 && lower.includes(key.slice(0, Math.min(8, key.length)))) score += 0.1;
  }
  if (shop.address) {
    const addr = shop.address.toLowerCase();
    if (addr.includes('tattoo')) score += 0.04;
  }
  return Math.min(0.98, score);
};

const buildSearchQueries = (shop: ShopLookupInput): string[] => {
  const base = [shop.shopName, shop.address].filter(Boolean).join(' ');
  const website = ensureHttp(shop.website || '') || '';
  let domain = '';
  try {
    if (website) {
      domain = new URL(website).hostname.replace(/^www\./i, '');
    }
  } catch {}

  const queries = [
    `${base}`,
    `${base} instagram`,
    `${base} site:instagram.com`,
    `${shop.shopName || ''} ${shop.address || ''} tattoo`,
    `${shop.shopName || ''} instagram`,
    `${base} facebook`,
    `${base} tiktok`,
    `${base} tattoo studio social media`,
    ...(domain ? [`${domain} instagram`, `${shop.shopName || ''} ${domain} instagram`] : [])
  ].map((q) => q.trim()).filter(Boolean);

  return Array.from(new Set(queries));
};

const tokenize = (text: string): string[] =>
  String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter((x) => x.length >= 3);

const overlapScore = (a: string[], b: string[]): number => {
  if (a.length === 0 || b.length === 0) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let hit = 0;
  sa.forEach((x) => {
    if (sb.has(x)) hit += 1;
  });
  return hit / Math.max(1, Math.min(sa.size, sb.size));
};

const CONTENT_STYLE_KEYWORDS: Record<string, string[]> = {
  fine_line: ['fine line', 'fineline', 'single needle', 'micro'],
  blackwork: ['blackwork', 'black work', 'solid black'],
  realism: ['realism', 'realistic', 'portrait'],
  traditional: ['traditional', 'old school', 'neo traditional'],
  color: ['color tattoo', 'colour', 'vibrant', 'full color'],
  anime: ['anime', 'manga']
};

const CONTENT_PROMO_KEYWORDS = ['book now', 'dm to book', 'sale', 'discount', 'promo', 'giveaway', 'special offer'];
const CONTENT_EDU_KEYWORDS = ['tips', 'aftercare', 'healing', 'how to', 'guide', 'care'];
const CONTENT_SOCIAL_PROOF_KEYWORDS = ['client', 'healed', 'before after', 'cover up', 'session'];

const detectStyleTags = (text: string): string[] => {
  const lower = String(text || '').toLowerCase();
  const tags: string[] = [];
  for (const [tag, kws] of Object.entries(CONTENT_STYLE_KEYWORDS)) {
    if (kws.some((k) => lower.includes(k))) tags.push(tag);
  }
  return tags;
};

const detectTopicTag = (text: string): string => {
  const lower = String(text || '').toLowerCase();
  if (CONTENT_EDU_KEYWORDS.some((k) => lower.includes(k))) return 'education';
  if (CONTENT_SOCIAL_PROOF_KEYWORDS.some((k) => lower.includes(k))) return 'social_proof';
  if (CONTENT_PROMO_KEYWORDS.some((k) => lower.includes(k))) return 'promotion';
  return 'showcase';
};

const detectCtaTag = (text: string): string => {
  const lower = String(text || '').toLowerCase();
  if (lower.includes('dm')) return 'dm';
  if (lower.includes('book')) return 'book';
  if (lower.includes('link in bio')) return 'link_bio';
  if (lower.includes('comment')) return 'comment';
  return 'soft';
};

const emptySocialResult = {
  instagram: null as string | null,
  facebook: null as string | null,
  tiktok: null as string | null,
  emails: null as string[] | null,
  whatsapp: null as string[] | null,
  confidence: { instagram: 0, facebook: 0, tiktok: 0 }
};

const lookupSocialForShop = async (shop: ShopLookupInput) => {
  const merged = {
    instagram: [] as string[],
    facebook: [] as string[],
    tiktok: [] as string[],
    emails: [] as string[],
    whatsapp: [] as string[]
  };

  const websiteUrl = ensureHttp(shop.website);
  if (websiteUrl) {
    // Skip template-builder domains (Wix, Squarespace, Shopify) — their footer badges are not real social links
    try {
      const domain = new URL(websiteUrl).hostname.toLowerCase();
      if (TEMPLATE_DOMAINS.some(d => domain.includes(d))) return emptyResult;
    } catch {}
    const html = await fetchText(websiteUrl, 9000);
    const found = findSocialLinks(html, true);
    merged.instagram.push(...found.instagram);
    merged.facebook.push(...found.facebook);
    merged.tiktok.push(...found.tiktok);
    merged.emails.push(...found.emails);
    merged.whatsapp.push(...found.whatsapp);
  }

  if (merged.instagram.length === 0 || merged.facebook.length === 0 || merged.tiktok.length === 0) {
    const queries = buildSearchQueries(shop).slice(0, 6);
    for (const q of queries) {
      const endpoints = [
        `https://duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
        `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
        `https://www.google.com/search?q=${encodeURIComponent(q)}`
      ];
      for (const endpoint of endpoints) {
        const searchHtml = await fetchText(endpoint, 7500);
        if (!searchHtml) continue;
        const found = findSocialLinks(searchHtml);
        if (merged.instagram.length === 0) merged.instagram.push(...found.instagram);
        if (merged.facebook.length === 0) merged.facebook.push(...found.facebook);
        if (merged.tiktok.length === 0) merged.tiktok.push(...found.tiktok);
        merged.emails.push(...found.emails);
        merged.whatsapp.push(...found.whatsapp);
      }
    }
  }

  const instagram = pickBest(Array.from(new Set(merged.instagram)), 'instagram');
  const facebook = pickBest(Array.from(new Set(merged.facebook)), 'facebook');
  const tiktok = pickBest(Array.from(new Set(merged.tiktok)), 'tiktok');
  const emails = Array.from(new Set(merged.emails)).slice(0, 5);
  const whatsapp = Array.from(new Set(merged.whatsapp)).slice(0, 3);

  return {
    id: shop.id,
    instagram,
    facebook,
    tiktok,
    emails,
    whatsapp,
    confidence: {
      instagram: scoreCandidate(instagram, instagram && websiteUrl && merged.instagram.includes(instagram) ? 'website' : 'search', shop),
      facebook: scoreCandidate(facebook, facebook && websiteUrl && merged.facebook.includes(facebook) ? 'website' : 'search', shop),
      tiktok: scoreCandidate(tiktok, tiktok && websiteUrl && merged.tiktok.includes(tiktok) ? 'website' : 'search', shop)
    }
  };
};

interface ShopifyVariant {
  id: number;
  sku?: string;
  title?: string;
  price?: string;
  inventory_item_id?: number;
  inventory_quantity?: number;
}

interface ShopifyProduct {
  id: number;
  title: string;
  vendor?: string;
  product_type?: string;
  variants?: ShopifyVariant[];
}

const normalizeShopDomain = (raw: string): string => {
  const trimmed = String(raw || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return trimmed.toLowerCase();
};

const parseNextLink = (linkHeader: string | null): string | null => {
  if (!linkHeader) return null;
  const parts = linkHeader.split(',');
  for (const part of parts) {
    if (!part.includes('rel=\"next\"')) continue;
    const m = part.match(/<([^>]+)>/);
    if (m?.[1]) return m[1];
  }
  return null;
};

const shopifyFetch = async (url: string, accessToken: string) => {
  const resp = await fetch(url, {
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json'
    }
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Shopify API ${resp.status}: ${text.slice(0, 240)}`);
  }
  return resp;
};

async function startServer() {
  try {
    console.log('Starting server initialization...');
    const app = express();
    app.use(cors());
    app.use(express.json({ limit: '50mb' }));

    // ========== Neon 鏁版嵁搴撳垵濮嬪寲 ==========
    const DATABASE_URL = process.env.NEON_DATABASE_URL!;
    const sql = neon(DATABASE_URL);
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS scraped_shops (
          id SERIAL PRIMARY KEY,
          city TEXT,
          shop_name TEXT,
          address TEXT,
          phone TEXT,
          website TEXT,
          instagram TEXT,
          facebook TEXT,
          tiktok TEXT,
          email TEXT,
          place_id TEXT,
          scraped_at TIMESTAMP DEFAULT NOW(),
          task_id TEXT,
          UNIQUE(place_id, shop_name, address)
        );
      `;
      console.log('鉁?Neon table "scraped_shops" is ready');
    } catch (err) {
      console.error('Failed to create Neon table:', err);
    }

    // ========== 鏈湴 SQLite 鍒濆鍖?==========
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const deepScanDb = new Database(path.join(dataDir, 'deep_scan_tasks.db'));
    deepScanDb.pragma('journal_mode = WAL');
    deepScanDb.exec(`
      CREATE TABLE IF NOT EXISTS deep_scan_tasks (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS bot_instances (
        bot_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        status TEXT NOT NULL,
        last_heartbeat_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS bot_account_usage (
        account_id TEXT PRIMARY KEY,
        first_seen_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_bot_account_usage_last_seen ON bot_account_usage(last_seen_at DESC);
      CREATE TABLE IF NOT EXISTS automation_tasks (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        status TEXT NOT NULL,
        run_at INTEGER NOT NULL,
        lease_until INTEGER,
        leased_by TEXT,
        attempts INTEGER NOT NULL,
        max_attempts INTEGER NOT NULL,
        error_reason TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS scrape_tasks (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS bot_observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bot_id TEXT NOT NULL,
        command_id TEXT,
        artist_id TEXT,
        artist_handle TEXT,
        mode TEXT,
        summary_json TEXT NOT NULL,
        profile_facts_json TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_bot_obs_created_at ON bot_observations(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_bot_obs_artist_handle ON bot_observations(artist_handle);
      CREATE TABLE IF NOT EXISTS review_overrides (
        artist_handle TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_review_overrides_action ON review_overrides(action);
      CREATE TABLE IF NOT EXISTS bot_schedule (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS content_competitors (
        handle TEXT PRIMARY KEY,
        platform TEXT NOT NULL DEFAULT 'instagram',
        source TEXT,
        account_type TEXT NOT NULL DEFAULT 'supply_brand',
        active INTEGER NOT NULL DEFAULT 1,
        notes TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS content_samples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        handle TEXT NOT NULL,
        source_type TEXT NOT NULL DEFAULT 'observation',
        post_url TEXT,
        caption TEXT,
        style_tags_json TEXT,
        topic_tag TEXT,
        cta_tag TEXT,
        quality_score INTEGER NOT NULL DEFAULT 0,
        engagement_hint REAL NOT NULL DEFAULT 0,
        observed_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_content_samples_handle ON content_samples(handle);
      CREATE INDEX IF NOT EXISTS idx_content_samples_quality ON content_samples(quality_score DESC, engagement_hint DESC);
      CREATE TABLE IF NOT EXISTS content_templates (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS llm_brand_profile (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS llm_tasks (
        id TEXT PRIMARY KEY,
        pipeline TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL,
        run_at INTEGER NOT NULL,
        lease_until INTEGER,
        leased_by TEXT,
        attempts INTEGER NOT NULL,
        max_attempts INTEGER NOT NULL,
        error_reason TEXT,
        result_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_llm_tasks_status_runat ON llm_tasks(status, run_at);
      CREATE TABLE IF NOT EXISTS content_publish_tasks (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        bot_id TEXT,
        account_id TEXT,
        content_id TEXT,
        payload TEXT NOT NULL,
        status TEXT NOT NULL,
        scheduled_at INTEGER NOT NULL,
        lease_until INTEGER,
        leased_by TEXT,
        published_at INTEGER,
        platform_post_id TEXT,
        error_reason TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_publish_tasks_status_sched ON content_publish_tasks(status, scheduled_at);
      CREATE TABLE IF NOT EXISTS content_engagement (
        content_id TEXT PRIMARY KEY,
        likes INTEGER NOT NULL DEFAULT 0,
        comments INTEGER NOT NULL DEFAULT 0,
        views INTEGER NOT NULL DEFAULT 0,
        reported_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ig_profile_data (
        artist_id TEXT PRIMARY KEY,
        followers INTEGER NOT NULL DEFAULT 0,
        following INTEGER NOT NULL DEFAULT 0,
        posts INTEGER NOT NULL DEFAULT 0,
        bio TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT '',
        is_verified INTEGER NOT NULL DEFAULT 0,
        is_private INTEGER NOT NULL DEFAULT 0,
        avg_likes REAL NOT NULL DEFAULT 0,
        avg_comments REAL NOT NULL DEFAULT 0,
        post_frequency_days REAL NOT NULL DEFAULT 0,
        last_post_date TEXT NOT NULL DEFAULT '',
        posts_sample TEXT NOT NULL DEFAULT '[]',
        scanned_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS ig_relationships (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_handle TEXT NOT NULL,
        source_ig_user_id TEXT NOT NULL,
        target_username TEXT NOT NULL,
        target_full_name TEXT NOT NULL DEFAULT '',
        target_profile_pic_url TEXT NOT NULL DEFAULT '',
        target_is_private INTEGER NOT NULL DEFAULT 0,
        target_is_verified INTEGER NOT NULL DEFAULT 0,
        relationship_type TEXT NOT NULL CHECK(relationship_type IN ('follower','following')),
        observed_at INTEGER NOT NULL,
        UNIQUE(source_ig_user_id, target_username, relationship_type)
      );
      CREATE INDEX IF NOT EXISTS idx_ig_rel_source ON ig_relationships(source_handle, relationship_type);
      CREATE INDEX IF NOT EXISTS idx_ig_rel_target ON ig_relationships(target_username, relationship_type);
      CREATE INDEX IF NOT EXISTS idx_ig_rel_source_user ON ig_relationships(source_ig_user_id);
      CREATE TABLE IF NOT EXISTS ig_follow_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bot_id TEXT NOT NULL,
        target_handle TEXT NOT NULL,
        target_ig_user_id TEXT NOT NULL DEFAULT '',
        followed_at INTEGER NOT NULL,
        follow_back_detected INTEGER NOT NULL DEFAULT 0,
        follow_back_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_ig_fa_bot ON ig_follow_actions(bot_id, target_handle);

      -- Competitive intelligence: product tracking
      CREATE TABLE IF NOT EXISTS competitor_products (
        id TEXT PRIMARY KEY,
        brand_name TEXT NOT NULL,
        product_name TEXT NOT NULL,
        product_url TEXT,
        price TEXT,
        currency TEXT DEFAULT 'USD',
        first_seen_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        source TEXT NOT NULL,
        image_urls TEXT DEFAULT '[]',
        status TEXT DEFAULT 'active'
      );
      CREATE INDEX IF NOT EXISTS idx_cp_brand ON competitor_products(brand_name, status);

      -- Competitive intelligence: review aggregation
      CREATE TABLE IF NOT EXISTS competitor_reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_name TEXT NOT NULL,
        source TEXT NOT NULL,
        source_url TEXT,
        reviewer_name TEXT,
        rating INTEGER,
        review_text TEXT NOT NULL,
        sentiment TEXT,
        key_themes TEXT DEFAULT '[]',
        reviewed_at TEXT,
        scraped_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cr_product ON competitor_reviews(product_name, sentiment);

      -- Competitive intelligence: brand mentions (forum/social)
      CREATE TABLE IF NOT EXISTS brand_mentions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL,
        subreddit_or_forum TEXT,
        post_title TEXT,
        post_url TEXT UNIQUE,
        author TEXT,
        content TEXT,
        mentioned_brands TEXT DEFAULT '[]',
        sentiment TEXT,
        engagement_score INTEGER DEFAULT 0,
        posted_at TEXT,
        scraped_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_bm_platform ON brand_mentions(platform, scraped_at);

      -- Competitive intelligence: alerts/notifications
      CREATE TABLE IF NOT EXISTS competitor_alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        brand_name TEXT NOT NULL,
        alert_type TEXT NOT NULL,
        title TEXT NOT NULL,
        details TEXT,
        source_url TEXT,
        is_read INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ca_brand ON competitor_alerts(brand_name, is_read);

      -- AI review queue: low/medium confidence classifications for human verification
      CREATE TABLE IF NOT EXISTS review_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_type TEXT NOT NULL,
        source_url TEXT,
        original_title TEXT,
        original_text TEXT NOT NULL,
        ai_classification TEXT NOT NULL,
        confidence TEXT NOT NULL,
        review_status TEXT NOT NULL DEFAULT 'pending',
        reviewer_notes TEXT,
        reviewed_at INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_rq_status ON review_queue(review_status, confidence);

      -- DEV account system: user accounts with roles
      CREATE TABLE IF NOT EXISTS user_accounts (
        user_id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        api_key TEXT UNIQUE NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        is_active INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- DEV account system: per-user feature access control
      CREATE TABLE IF NOT EXISTS feature_access (
        user_id TEXT NOT NULL,
        feature_key TEXT NOT NULL,
        enabled INTEGER DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, feature_key),
        FOREIGN KEY (user_id) REFERENCES user_accounts(user_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_fa_user ON feature_access(user_id);

      -- Marketing scripts: categorized sales pitches for follow-back DM outreach
      CREATE TABLE IF NOT EXISTS marketing_scripts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,          -- product_intro | collaboration | industry_talk | after_sales
        direction TEXT NOT NULL,         -- 方向引导: website | sample | tech_discussion | vip | etc
        title TEXT NOT NULL,
        content TEXT NOT NULL,           -- the actual script text
        tone TEXT NOT NULL DEFAULT 'professional',  -- professional | casual | friendly
        tags TEXT DEFAULT '',            -- comma-separated tags for matching
        match_conditions TEXT DEFAULT '{}',  -- JSON: conditions when this script should be selected
        active INTEGER DEFAULT 1,
        usage_count INTEGER DEFAULT 0,
        success_rate REAL DEFAULT 0,     -- ratio of positive responses
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ms_category ON marketing_scripts(category);

      -- Marketing follow-up tasks: created on follow-back, consumed by bot DM execution
      CREATE TABLE IF NOT EXISTS marketing_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_handle TEXT NOT NULL,
        target_name TEXT DEFAULT '',
        artist_id TEXT,
        bot_id TEXT,                     -- which bot detected the follow-back
        category TEXT NOT NULL,          -- script category selected
        direction TEXT NOT NULL,         -- direction guide
        script_id INTEGER,               -- which script was chosen (nullable, AI-gen may be custom)
        script_content TEXT,             -- the actual message to send
        status TEXT NOT NULL DEFAULT 'pending',  -- pending | sent | replied | converted | failed
        dm_method TEXT NOT NULL DEFAULT 'instagram_dm',  -- instagram_dm | comment | email
        lead_score INTEGER DEFAULT 0,
        touch_count INTEGER DEFAULT 0,
        sent_at INTEGER,
        reply_at INTEGER,
        converted_at INTEGER,
        reply_text TEXT,
        conversation_log TEXT DEFAULT '[]',  -- JSON array of message history
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_mt_status ON marketing_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_mt_handle ON marketing_tasks(target_handle);

      -- Bot profile adjustments: auto-learned overrides from behavior analysis
      -- Merge on top of hash-generated base profile for each bot
      CREATE TABLE IF NOT EXISTS bot_profile_adjustments (
        bot_id TEXT PRIMARY KEY,
        adjustments_json TEXT NOT NULL DEFAULT '{}',  -- { "likeStrategy": "generous", "liking.maxPerVisit": 5 }
        analysis_json TEXT DEFAULT '{}',              -- latest analysis results for reference
        confidence REAL DEFAULT 0,                    -- 0-1: how confident in the adjustments
        analyzed_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Daily bot stats: growth, engagement, DM conversion per bot per day
      CREATE TABLE IF NOT EXISTS daily_bot_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bot_id TEXT NOT NULL,
        date TEXT NOT NULL,
        followers_gained INTEGER DEFAULT 0,
        followers_lost INTEGER DEFAULT 0,
        total_followers INTEGER DEFAULT 0,
        likes_given INTEGER DEFAULT 0,
        comments_given INTEGER DEFAULT 0,
        follows_done INTEGER DEFAULT 0,
        unfollows_done INTEGER DEFAULT 0,
        dms_sent INTEGER DEFAULT 0,
        dms_replied INTEGER DEFAULT 0,
        dms_converted INTEGER DEFAULT 0,
        posts_published INTEGER DEFAULT 0,
        comments_received INTEGER DEFAULT 0,
        comments_replied INTEGER DEFAULT 0,
        profile_visits INTEGER DEFAULT 0,
        actions_by_hour TEXT DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(bot_id, date)
      );
      CREATE INDEX IF NOT EXISTS idx_dbs_date ON daily_bot_stats(date);
      CREATE INDEX IF NOT EXISTS idx_dbs_bot ON daily_bot_stats(bot_id);

      -- ===== Inventory System Tables =====

      -- Products (SKU master data)
      CREATE TABLE IF NOT EXISTS inventory_products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sku TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        category TEXT DEFAULT 'General',
        vendor TEXT DEFAULT '',
        unit TEXT DEFAULT 'Box',
        unit_price REAL DEFAULT 0,
        reorder_point INTEGER DEFAULT 50,       -- 警戒库存
        reorder_qty INTEGER DEFAULT 1000,        -- 建议采购量
        lead_time_days INTEGER DEFAULT 45,       -- 供应商生产周期
        moq INTEGER DEFAULT 500,                 -- 最小起订量
        carton_qty INTEGER DEFAULT 100,          -- 箱规
        source TEXT DEFAULT 'manual',            -- manual | shopify
        shopify_variant_id INTEGER,              -- 关联 Shopify variant
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Inbound records (入库记录)
      CREATE TABLE IF NOT EXISTS inventory_inbounds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_sku TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        po_number TEXT DEFAULT '',               -- 采购单号
        inbound_date TEXT NOT NULL,
        note TEXT DEFAULT '',
        created_at INTEGER NOT NULL,
        FOREIGN KEY (product_sku) REFERENCES inventory_products(sku)
      );
      CREATE INDEX IF NOT EXISTS idx_inv_inb_sku ON inventory_inbounds(product_sku);
      CREATE INDEX IF NOT EXISTS idx_inv_inb_date ON inventory_inbounds(inbound_date);

      -- Outbound records (出库记录)
      CREATE TABLE IF NOT EXISTS inventory_outbounds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_sku TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        channel TEXT NOT NULL,                   -- B2C | B2B
        customer_name TEXT DEFAULT '',           -- B2B customer or Shopify customer
        shopify_order_id TEXT DEFAULT '',        -- Shopify order ID for B2C
        outbound_date TEXT NOT NULL,
        note TEXT DEFAULT '',
        created_at INTEGER NOT NULL,
        FOREIGN KEY (product_sku) REFERENCES inventory_products(sku)
      );
      CREATE INDEX IF NOT EXISTS idx_inv_out_sku ON inventory_outbounds(product_sku);
      CREATE INDEX IF NOT EXISTS idx_inv_out_date ON inventory_outbounds(outbound_date);
      CREATE INDEX IF NOT EXISTS idx_inv_out_cust ON inventory_outbounds(customer_name);

      -- Customers (客户管理)
      CREATE TABLE IF NOT EXISTS inventory_customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        email TEXT DEFAULT '',
        instagram TEXT DEFAULT '',
        country TEXT DEFAULT '',
        customer_type TEXT DEFAULT 'Studio',     -- Studio | Distributor | Retail
        total_orders INTEGER DEFAULT 0,
        total_spent REAL DEFAULT 0,
        last_order_date TEXT DEFAULT '',
        first_order_date TEXT DEFAULT '',
        avg_order_days REAL DEFAULT 0,           -- 平均复购周期
        status TEXT DEFAULT 'Active',            -- Active | Inactive | Lost
        notes TEXT DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_inv_cust_name ON inventory_customers(name);
      CREATE INDEX IF NOT EXISTS idx_inv_cust_type ON inventory_customers(customer_type);
      CREATE INDEX IF NOT EXISTS idx_inv_cust_status ON inventory_customers(status);

      -- Purchase Orders (采购单)
      CREATE TABLE IF NOT EXISTS purchase_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        po_number TEXT UNIQUE NOT NULL,
        supplier TEXT DEFAULT '',
        status TEXT DEFAULT 'draft',             -- draft | sent | received | cancelled
        order_date TEXT NOT NULL,
        expected_date TEXT DEFAULT '',
        created_at INTEGER NOT NULL,
        notes TEXT DEFAULT ''
      );

      -- Purchase Order Items (采购单明细)
      CREATE TABLE IF NOT EXISTS purchase_order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        po_id INTEGER NOT NULL,
        product_sku TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        unit_cost REAL DEFAULT 0,
        FOREIGN KEY (po_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
        FOREIGN KEY (product_sku) REFERENCES inventory_products(sku)
      );
      CREATE INDEX IF NOT EXISTS idx_inv_poi_sku ON purchase_order_items(product_sku);

      -- Purchase History (采购历史 — 用于分析供应商交期等)
      CREATE TABLE IF NOT EXISTS purchase_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_sku TEXT NOT NULL,
        po_number TEXT NOT NULL,
        ordered_qty INTEGER NOT NULL,
        received_qty INTEGER DEFAULT 0,
        order_date TEXT NOT NULL,
        received_date TEXT DEFAULT '',
        supplier TEXT DEFAULT '',
        lead_time_days INTEGER DEFAULT 0,
        FOREIGN KEY (product_sku) REFERENCES inventory_products(sku)
      );
      CREATE INDEX IF NOT EXISTS idx_inv_ph_sku ON purchase_history(product_sku);

      -- ============ Order Fulfillment (订单履约) ============

      -- Packaging Boxes (包装箱预设)
      CREATE TABLE IF NOT EXISTS order_boxes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,                -- 箱型名称，如 "小箱(20x15x10)"
        length_cm REAL NOT NULL,
        width_cm REAL NOT NULL,
        height_cm REAL NOT NULL,
        max_units INTEGER NOT NULL DEFAULT 0,  -- 最多装几盒/件
        weight_g REAL DEFAULT 0,           -- 箱子自重(g)
        carrier TEXT DEFAULT '',            -- 适用物流商
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );

      -- Orders (订单)
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_number TEXT UNIQUE NOT NULL,  -- Shopify 订单号
        source TEXT DEFAULT 'shopify',      -- 来源 shopify/manual
        status TEXT DEFAULT 'pending',      -- pending|processing|shipped|cancelled
        customer_name TEXT NOT NULL,
        customer_email TEXT DEFAULT '',
        country TEXT NOT NULL,              -- 目的国
        state TEXT DEFAULT '',
        city TEXT DEFAULT '',
        zip_code TEXT DEFAULT '',
        address TEXT DEFAULT '',
        phone TEXT DEFAULT '',
        carrier TEXT DEFAULT '',            -- 分配的物流商
        box_id INTEGER DEFAULT 0,           -- 使用的包装箱
        tracking_number TEXT DEFAULT '',
        tracking_url TEXT DEFAULT '',
        shipping_cost REAL DEFAULT 0,
        currency TEXT DEFAULT 'USD',
        notes TEXT DEFAULT '',
        paypal_transaction TEXT DEFAULT '',
        shopify_fulfillment_id TEXT DEFAULT '',
        shipped_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
      CREATE INDEX IF NOT EXISTS idx_orders_carrier ON orders(carrier);
      CREATE INDEX IF NOT EXISTS idx_orders_country ON orders(country);

      -- Order Items (订单商品)
      CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        sku TEXT DEFAULT '',
        product_name TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1,
        unit_price REAL DEFAULT 0,
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

      -- Shipments (发货记录)
      CREATE TABLE IF NOT EXISTS shipments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        carrier TEXT NOT NULL,              -- yanwen / equick
        waybill_number TEXT NOT NULL,       -- 运单号
        status TEXT DEFAULT 'created',      -- created|label_printed|picked_up|in_transit|delivered
        label_url TEXT DEFAULT '',
        package_length_cm REAL DEFAULT 0,
        package_width_cm REAL DEFAULT 0,
        package_height_cm REAL DEFAULT 0,
        package_weight_g REAL DEFAULT 0,
        shipping_cost REAL DEFAULT 0,
        currency TEXT DEFAULT 'USD',
        shipped_at INTEGER,
        delivered_at INTEGER,
        carrier_response TEXT DEFAULT '',    -- 物流商原始返回
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_shipments_order ON shipments(order_id);
      CREATE INDEX IF NOT EXISTS idx_shipments_carrier ON shipments(carrier);

      -- Carrier Configs (物流商配置)
      CREATE TABLE IF NOT EXISTS carrier_configs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        carrier TEXT UNIQUE NOT NULL,       -- yanwen / equick
        label TEXT NOT NULL,                -- 显示名
        api_base_url TEXT NOT NULL,
        api_key TEXT DEFAULT '',
        api_secret TEXT DEFAULT '',
        extra_config TEXT DEFAULT '{}',     -- JSON，渠道编码等额外配置
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO carrier_configs (carrier, label, api_base_url, api_key, api_secret, extra_config, created_at)
      VALUES ('yanwen', '燕文物流', 'https://open-fat.yw56.com.cn/api/order', '100000', 'D6140AA383FD8515B09028C586493DDB', '{"channelId":"481"}', unixepoch());
      INSERT OR IGNORE INTO carrier_configs (carrier, label, api_base_url, api_key, api_secret, extra_config, created_at)
      VALUES ('equick', '易快通(E-Quick)', 'http://121.40.107.122:20000/pos-web/', 'CSKH', 'de9ca35c9e7b45ccb63ba878f8a89049', '{"hubInCode":"FED-CJJ"}', unixepoch());
    `);
    const BOT_ONLINE_TTL_MS = 60 * 1000;
    const BOT_LEASE_MS = 90 * 1000;
    const BOT_API_KEY = (process.env.BOT_API_KEY || '').trim();

    // Inventory DB migrations (safe add columns)
    try { deepScanDb.exec(`ALTER TABLE inventory_products ADD COLUMN barcode TEXT DEFAULT ''`); } catch {}
    try { deepScanDb.exec(`ALTER TABLE inventory_products ADD COLUMN image_url TEXT DEFAULT ''`); } catch {}

    const toBotPayload = (raw: any): BotInstancePayload => ({
      botId: String(raw?.botId || '').trim(),
      accountIds: Array.isArray(raw?.accountIds)
        ? raw.accountIds.map((x: any) => String(x || '').trim()).filter(Boolean)
        : [],
      host: raw?.host ? String(raw.host) : undefined,
      ip: raw?.ip ? String(raw.ip) : undefined,
      version: raw?.version ? String(raw.version) : undefined,
      meta: raw?.meta && typeof raw.meta === 'object' ? raw.meta : undefined
    });

    const requireBotAuth = (req: express.Request, res: express.Response): boolean => {
      if (!BOT_API_KEY) return true;
      const incoming = String(req.headers['x-bot-key'] || '');
      if (incoming !== BOT_API_KEY) {
        res.status(401).json({ error: 'Invalid bot auth key' });
        return false;
      }
      return true;
    };

    // DEV account auth — checks x-dev-key header against user_accounts with role='dev'
    const requireDevAuth = (req: express.Request, res: express.Response): { userId: string } | null => {
      const apiKey = String(req.headers['x-dev-key'] || '').trim();
      if (!apiKey) { res.status(401).json({ error: 'x-dev-key header required' }); return null; }
      const user = deepScanDb.prepare(
        'SELECT user_id, role FROM user_accounts WHERE api_key = ? AND is_active = 1'
      ).get(apiKey) as any;
      if (!user || user.role !== 'dev') { res.status(403).json({ error: 'DEV access required' }); return null; }
      return { userId: user.user_id };
    };

    // Check if a user has access to a feature
    const checkFeatureAccess = (userId: string, featureKey: string): boolean => {
      const row = deepScanDb.prepare(
        'SELECT enabled FROM feature_access WHERE user_id = ? AND feature_key = ?'
      ).get(userId, featureKey) as any;
      return row?.enabled === 1;
    };

    // Default feature set for new users
    const DEFAULT_FEATURES = [
      'content_bot', 'product_tracker', 'forum_monitor',
      'competitor_research', 'content_calendar', 'content_guide',
      'pipeline', 'analytics', 'intel_access',
    ];

    const ensureFeatureAccess = (userId: string) => {
      const now = Date.now();
      const stmt = deepScanDb.prepare(
        'INSERT OR IGNORE INTO feature_access (user_id, feature_key, enabled, updated_at) VALUES (?, ?, 1, ?)'
      );
      for (const f of DEFAULT_FEATURES) stmt.run(userId, f, now);
    };

    const upsertBot = (payload: BotInstancePayload) => {
      const now = Date.now();
      deepScanDb
        .prepare(`
          INSERT INTO bot_instances (bot_id, payload, status, last_heartbeat_at, updated_at)
          VALUES (?, ?, 'online', ?, ?)
          ON CONFLICT(bot_id) DO UPDATE SET
            payload = excluded.payload,
            status = CASE
              WHEN bot_instances.status = 'paused' THEN 'paused'
              ELSE 'online'
            END,
            last_heartbeat_at = excluded.last_heartbeat_at,
            updated_at = excluded.updated_at
        `)
        .run(payload.botId, JSON.stringify(payload), now, now);

      if (payload.accountIds?.length) {
        const upsertAccountStmt = deepScanDb.prepare(`
          INSERT INTO bot_account_usage (account_id, first_seen_at, last_seen_at)
          VALUES (?, ?, ?)
          ON CONFLICT(account_id) DO UPDATE SET
            last_seen_at = excluded.last_seen_at
        `);
        for (const accountId of payload.accountIds) {
          const id = String(accountId || '').trim();
          if (!id) continue;
          upsertAccountStmt.run(id, now, now);
        }
      }
    };

    const getBotRow = (botId: string) => {
      return deepScanDb
        .prepare('SELECT bot_id, payload, status, last_heartbeat_at, updated_at FROM bot_instances WHERE bot_id = ?')
        .get(botId) as
        | { bot_id: string; payload: string; status: string; last_heartbeat_at: number; updated_at: number }
        | undefined;
    };

    const getBotOnlineState = (botId: string): { exists: boolean; online: boolean; paused: boolean; staleMs: number } => {
      const row = getBotRow(botId);
      if (!row) return { exists: false, online: false, paused: false, staleMs: Number.MAX_SAFE_INTEGER };
      const staleMs = Date.now() - Number(row.last_heartbeat_at || 0);
      const paused = String(row.status || '') === 'paused';
      const online = staleMs <= BOT_ONLINE_TTL_MS && !paused;
      return { exists: true, online, paused, staleMs };
    };

    const DEFAULT_BOT_SCHEDULE: BotScheduleConfig = {
      enabled: false,
      pauseWindow: { start: '22:00', end: '23:30' },
      resumeWindow: { start: '08:30', end: '10:00' },
      resumeBotIds: []
    };

    const parseHmToMinute = (hm: string): number => {
      const m = String(hm || '').match(/^(\d{1,2}):(\d{2})$/);
      if (!m) return 0;
      const h = Math.max(0, Math.min(23, Number(m[1])));
      const mm = Math.max(0, Math.min(59, Number(m[2])));
      return h * 60 + mm;
    };

    const getTodayKey = () => {
      const d = new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    const minuteRangeRandom = (startHm: string, endHm: string): number => {
      const start = parseHmToMinute(startHm);
      const end = parseHmToMinute(endHm);
      if (start === end) return start;
      if (start < end) return start + Math.floor(Math.random() * (end - start + 1));
      // Cross-midnight window (rare here)
      const span = (24 * 60 - start) + end;
      const offset = Math.floor(Math.random() * (span + 1));
      return (start + offset) % (24 * 60);
    };

    const minuteToTsToday = (minute: number): number => {
      const now = new Date();
      const h = Math.floor(minute / 60);
      const m = minute % 60;
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
      return d.getTime();
    };

    const loadBotScheduleConfig = (): BotScheduleConfig => {
      const row = deepScanDb
        .prepare(`SELECT payload FROM bot_schedule WHERE id = 'config'`)
        .get() as { payload: string } | undefined;
      if (!row) return { ...DEFAULT_BOT_SCHEDULE };
      try {
        const p = JSON.parse(row.payload || '{}');
        return {
          enabled: p?.enabled === true,
          pauseWindow: {
            start: String(p?.pauseWindow?.start || DEFAULT_BOT_SCHEDULE.pauseWindow.start),
            end: String(p?.pauseWindow?.end || DEFAULT_BOT_SCHEDULE.pauseWindow.end)
          },
          resumeWindow: {
            start: String(p?.resumeWindow?.start || DEFAULT_BOT_SCHEDULE.resumeWindow.start),
            end: String(p?.resumeWindow?.end || DEFAULT_BOT_SCHEDULE.resumeWindow.end)
          },
          resumeBotIds: Array.isArray(p?.resumeBotIds) ? p.resumeBotIds.map((x: any) => String(x)).filter(Boolean) : []
        };
      } catch {
        return { ...DEFAULT_BOT_SCHEDULE };
      }
    };

    const saveBotScheduleConfig = (cfg: BotScheduleConfig) => {
      const now = Date.now();
      deepScanDb
        .prepare(`
          INSERT INTO bot_schedule (id, payload, updated_at)
          VALUES ('config', ?, ?)
          ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
        `)
        .run(JSON.stringify(cfg), now);
    };

    const loadBotScheduleState = (): BotScheduleState | null => {
      const row = deepScanDb
        .prepare(`SELECT payload FROM bot_schedule WHERE id = 'state'`)
        .get() as { payload: string } | undefined;
      if (!row) return null;
      try {
        const p = JSON.parse(row.payload || '{}');
        if (!p?.date) return null;
        return {
          date: String(p.date),
          pauseAt: Number(p.pauseAt || 0),
          resumeAt: Number(p.resumeAt || 0),
          pauseDone: p.pauseDone === true,
          resumeDone: p.resumeDone === true
        };
      } catch {
        return null;
      }
    };

    const saveBotScheduleState = (state: BotScheduleState) => {
      const now = Date.now();
      deepScanDb
        .prepare(`
          INSERT INTO bot_schedule (id, payload, updated_at)
          VALUES ('state', ?, ?)
          ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
        `)
        .run(JSON.stringify(state), now);
    };

    const pauseAllBotsInternal = (): number => {
      const now = Date.now();
      const r = deepScanDb
        .prepare(`UPDATE bot_instances SET status = 'paused', updated_at = ?`)
        .run(now);
      return Number(r.changes || 0);
    };

    const resumeBotsInternal = (botIds: string[]): number => {
      const now = Date.now();
      if (!botIds.length) return 0;
      const stmt = deepScanDb.prepare(`UPDATE bot_instances SET status = 'online', updated_at = ? WHERE bot_id = ?`);
      let changed = 0;
      for (const id of botIds) {
        const r = stmt.run(now, id);
        changed += Number(r.changes || 0);
      }
      return changed;
    };

    const recycleExpiredAutomationLeases = () => {
      const now = Date.now();
      deepScanDb
        .prepare(`
          UPDATE automation_tasks
          SET status = 'pending',
              lease_until = NULL,
              leased_by = NULL,
              updated_at = ?
          WHERE status IN ('leased','running') AND lease_until IS NOT NULL AND lease_until < ?
        `)
        .run(now, now);
      deepScanDb
        .prepare(`
          UPDATE automation_tasks
          SET status = 'failed',
              error_reason = 'max_attempts',
              updated_at = ?
          WHERE status = 'pending' AND attempts >= max_attempts
        `)
        .run(now);
    };

    const runBotScheduleTick = () => {
      try {
        const cfg = loadBotScheduleConfig();
        if (!cfg.enabled) return;

        const today = getTodayKey();
        let state = loadBotScheduleState();
        if (!state || state.date !== today) {
          const pauseMinute = minuteRangeRandom(cfg.pauseWindow.start, cfg.pauseWindow.end);
          const resumeMinute = minuteRangeRandom(cfg.resumeWindow.start, cfg.resumeWindow.end);
          state = {
            date: today,
            pauseAt: minuteToTsToday(pauseMinute),
            resumeAt: minuteToTsToday(resumeMinute),
            pauseDone: false,
            resumeDone: false
          };
          saveBotScheduleState(state);
          console.log(`[bot-schedule] ${today} pause@${new Date(state.pauseAt).toLocaleTimeString()} resume@${new Date(state.resumeAt).toLocaleTimeString()} bots=${cfg.resumeBotIds.join(',') || 'none'}`);
        }

        const now = Date.now();
        if (!state.pauseDone && now >= state.pauseAt) {
          const paused = pauseAllBotsInternal();
          state.pauseDone = true;
          saveBotScheduleState(state);
          console.log(`[bot-schedule] pause-all triggered, paused=${paused}`);
        }

        if (!state.resumeDone && now >= state.resumeAt) {
          const resumed = resumeBotsInternal(cfg.resumeBotIds);
          state.resumeDone = true;
          saveBotScheduleState(state);
          console.log(`[bot-schedule] resume-selected triggered, resumed=${resumed}, targets=${cfg.resumeBotIds.join(',') || 'none'}`);
        }
      } catch (e: any) {
        console.warn('[bot-schedule] tick error:', e?.message || String(e));
      }
    };

    // Random-window bot day scheduler (pause all + resume selected bots)
    setInterval(() => {
      runBotScheduleTick();
    }, 30 * 1000);
    runBotScheduleTick();

    const loadDeepTask = (taskId: string): DeepScanTask | null => {
      const row = deepScanDb
        .prepare('SELECT payload FROM deep_scan_tasks WHERE id = ?')
        .get(taskId) as { payload: string } | undefined;
      if (!row) return null;
      try {
        return JSON.parse(row.payload) as DeepScanTask;
      } catch {
        return null;
      }
    };

    const saveDeepTask = (task: DeepScanTask) => {
      task.updatedAt = new Date().toISOString();
      deepScanDb
        .prepare(`
          INSERT INTO deep_scan_tasks (id, payload, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            payload = excluded.payload,
            updated_at = excluded.updated_at
        `)
        .run(task.id, JSON.stringify(task), Date.now());
    };

    const gcDeepTasks = () => {
      const ttlMs = 14 * 24 * 60 * 60 * 1000;
      const cutoff = Date.now() - ttlMs;
      deepScanDb.prepare('DELETE FROM deep_scan_tasks WHERE updated_at < ?').run(cutoff);
      deepScanDb.prepare('DELETE FROM automation_tasks WHERE updated_at < ? AND status IN (\'done\', \'failed\')').run(cutoff);
      deepScanDb.prepare('DELETE FROM bot_instances WHERE updated_at < ?').run(cutoff);
    };

    gcDeepTasks();

    const getDeepTask = (taskId: string): DeepScanTask | null => {
      const task = loadDeepTask(taskId);
      if (!task) return null;
      let dirty = false;
      if (!task.failedReasonById || typeof task.failedReasonById !== 'object') {
        task.failedReasonById = {};
        dirty = true;
      }
      const now = Date.now();
      const releasedIds = Object.keys(task.leasedUntilById).filter((id) => task.leasedUntilById[id] <= now);
      if (releasedIds.length > 0) {
        releasedIds.forEach((id) => {
          delete task.leasedUntilById[id];
          if (
            !task.pendingIds.includes(id) &&
            !task.completedIds.includes(id) &&
            !task.failedIds.includes(id)
          ) {
            task.pendingIds.push(id);
          }
        });
        dirty = true;
      }
      if (
        task.status === 'running' &&
        task.pendingIds.length === 0 &&
        Object.keys(task.leasedUntilById).length === 0
      ) {
        task.status = 'completed';
        dirty = true;
      }
      if (dirty) saveDeepTask(task);
      return task;
    };

    const toTaskStatus = (task: DeepScanTask) => ({
      failedReasonStats: task.failedIds.reduce((acc: Record<string, number>, id) => {
        const reason = normalizeFailedReason(task.failedReasonById[id]);
        acc[reason] = (acc[reason] || 0) + 1;
        return acc;
      }, {}),
      failedItemsSample: task.failedIds.slice(0, 200).map((id) => ({
        id,
        reason: normalizeFailedReason(task.failedReasonById[id])
      })),
      id: task.id,
      status: task.status,
      total: task.total,
      completed: task.completedIds.length,
      failed: task.failedIds.length,
      pending: task.pendingIds.length,
      leased: Object.keys(task.leasedUntilById).length,
      updatedAt: task.updatedAt,
      failedIdsSample: task.failedIds.slice(0, 200)
    });

    const getLatestDeepTask = (): DeepScanTask | null => {
      const row = deepScanDb
        .prepare('SELECT id FROM deep_scan_tasks ORDER BY updated_at DESC LIMIT 1')
        .get() as { id: string } | undefined;
      if (!row?.id) return null;
      return getDeepTask(row.id);
    };

    const saveScrapeTask = (task: any) => {
      try {
        deepScanDb
          .prepare(`
            INSERT INTO scrape_tasks (id, payload, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              payload = excluded.payload,
              updated_at = excluded.updated_at
          `)
          .run(String(task.id), JSON.stringify(task), Date.now());
      } catch {}
    };

    const loadScrapeTask = (taskId: string): any | null => {
      try {
        const row = deepScanDb
          .prepare('SELECT payload FROM scrape_tasks WHERE id = ?')
          .get(taskId) as { payload: string } | undefined;
        if (!row?.payload) return null;
        return JSON.parse(row.payload);
      } catch {
        return null;
      }
    };

    const listScrapeTasks = (limit: number = 200): any[] => {
      try {
        const rows = deepScanDb
          .prepare('SELECT payload FROM scrape_tasks ORDER BY updated_at DESC LIMIT ?')
          .all(limit) as Array<{ payload: string }>;
        return rows
          .map((r) => {
            try { return JSON.parse(r.payload); } catch { return null; }
          })
          .filter(Boolean);
      } catch {
        return [];
      }
    };

    const leaseDeepScanBatch = (taskId: string, requestedLimit?: number): DeepScanLease | null => {
      const task = getDeepTask(taskId);
      if (!task || task.status !== 'running') return null;
      const limit = Number.isFinite(Number(requestedLimit)) && Number(requestedLimit) > 0
        ? Math.min(200, Math.floor(Number(requestedLimit)))
        : task.batchSize;
      const now = Date.now();
      const leaseMs = 2 * 60 * 1000;
      const ids = task.pendingIds.splice(0, limit);
      ids.forEach((id) => {
        task.leasedUntilById[id] = now + leaseMs;
      });
      saveDeepTask(task);
      return { taskId, artistIds: ids };
    };

    const applyDeepScanReport = (
      taskId: string,
      successIds: string[],
      failedItemsInput: Array<{ id: string; reason: string }>
    ): DeepScanTask | null => {
      const task = getDeepTask(taskId);
      if (!task) return null;
      const failedItems = failedItemsInput
        .map((x) => ({ id: String(x?.id || '').trim(), reason: normalizeFailedReason(x?.reason) }))
        .filter((x) => Boolean(x.id));

      successIds.forEach((id) => {
        delete task.leasedUntilById[id];
        if (!task.completedIds.includes(id)) task.completedIds.push(id);
        task.failedIds = task.failedIds.filter((x) => x !== id);
        delete task.failedReasonById[id];
      });

      failedItems.forEach(({ id, reason }) => {
        delete task.leasedUntilById[id];
        if (task.completedIds.includes(id)) return;
        const retries = (task.retryCountById[id] || 0) + 1;
        task.retryCountById[id] = retries;
        if (retries <= task.maxRetries) {
          if (!task.pendingIds.includes(id)) task.pendingIds.push(id);
        } else {
          if (!task.failedIds.includes(id)) task.failedIds.push(id);
          task.failedReasonById[id] = normalizeFailedReason(reason);
        }
      });

      saveDeepTask(task);
      return getDeepTask(task.id) || task;
    };

    const DEEP_SCAN_WORKER_CONCURRENCY = Math.max(2, Number(process.env.DEEP_SCAN_WORKER_CONCURRENCY || 8));
    const DEEP_SCAN_BATCH_SIZE = Math.max(5, Number(process.env.DEEP_SCAN_BATCH_SIZE || 20));
    const deepScanWorkerState = { running: false };

    const runDeepScanWorkerTick = async () => {
      if (deepScanWorkerState.running) return;
      deepScanWorkerState.running = true;
      try {
        const runningRows = deepScanDb
          .prepare('SELECT id FROM deep_scan_tasks ORDER BY updated_at DESC LIMIT 20')
          .all() as Array<{ id: string }>;
        for (const row of runningRows) {
          const task = getDeepTask(row.id);
          if (!task || task.status !== 'running') continue;

          const leased = leaseDeepScanBatch(task.id, DEEP_SCAN_BATCH_SIZE);
          if (!leased || leased.artistIds.length === 0) continue;

          const ids = leased.artistIds;
          try {
            const artists = await sql.query(
              'SELECT id, shop_name, website, address, phone FROM artists WHERE id = ANY($1::text[])',
              [ids]
            );

            const byId = new Map<string, any>();
            artists.forEach((a: any) => byId.set(String(a.id), a));

            const successIds: string[] = [];
            const failedItems: Array<{ id: string; reason: string }> = [];

            for (let i = 0; i < ids.length; i += DEEP_SCAN_WORKER_CONCURRENCY) {
              const chunkIds = ids.slice(i, i + DEEP_SCAN_WORKER_CONCURRENCY);
              const chunkInputs = chunkIds
                .map((id) => {
                  const a = byId.get(id);
                  if (!a) return null;
                  return {
                    id: String(a.id),
                    shopName: String(a.shop_name || ''),
                    website: String(a.website || ''),
                    address: String(a.address || ''),
                    phone: String(a.phone || '')
                  } as ShopLookupInput;
                })
                .filter(Boolean) as ShopLookupInput[];

              const chunkResults = await Promise.all(chunkInputs.map(async (input) => {
                try {
                  const result = await Promise.race([
                    lookupSocialForShop(input),
                    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 25000))
                  ]);
                  return { ok: true as const, input, result };
                } catch (e: any) {
                  const msg = String(e?.message || e || '').toLowerCase();
                  const reason = msg.includes('timeout') ? 'timeout' : (msg.includes('network') ? 'network' : 'social_lookup_error');
                  return { ok: false as const, input, reason };
                }
              }));

              for (const item of chunkResults) {
                if (!item.ok) {
                  failedItems.push({ id: item.input.id, reason: item.reason });
                  continue;
                }
                const { input, result } = item;
                try {
                  const instagram = result.instagram || null;
                  const facebook = result.facebook || null;
                  const email = (result.emails && result.emails.length > 0) ? result.emails.join('; ') : null;
                  await sql`
                    UPDATE artists
                    SET
                      ig_handle = COALESCE(NULLIF(${instagram}, ''), ig_handle),
                      facebook = COALESCE(NULLIF(${facebook}, ''), facebook),
                      email = COALESCE(NULLIF(${email}, ''), email),
                      last_updated = NOW()
                    WHERE id = ${input.id}
                  `;
                  successIds.push(input.id);
                } catch {
                  failedItems.push({ id: input.id, reason: 'firestore_write' });
                }
              }
            }

            applyDeepScanReport(task.id, successIds, failedItems);
          } catch {
            applyDeepScanReport(
              task.id,
              [],
              ids.map((id) => ({ id, reason: 'social_lookup_error' }))
            );
          }
        }
      } finally {
        deepScanWorkerState.running = false;
      }
    };

    setInterval(() => {
      void runDeepScanWorkerTick();
    }, 3000);

    // ========== Migration: content_competitors v2 ==========
    try { deepScanDb.exec(`ALTER TABLE content_competitors ADD COLUMN account_type TEXT NOT NULL DEFAULT 'supply_brand'`); } catch {}

    // ========== Migration: competitive intel v3 — deeper dimensions ==========
    try { deepScanDb.exec(`ALTER TABLE brand_mentions ADD COLUMN discussion_type TEXT`); } catch {}
    try { deepScanDb.exec(`ALTER TABLE brand_mentions ADD COLUMN artist_skill_level TEXT`); } catch {}
    try { deepScanDb.exec(`ALTER TABLE brand_mentions ADD COLUMN purchase_intent TEXT`); } catch {}
    try { deepScanDb.exec(`ALTER TABLE brand_mentions ADD COLUMN price_sensitivity TEXT`); } catch {}
    try { deepScanDb.exec(`ALTER TABLE competitor_reviews ADD COLUMN artist_skill_level TEXT`); } catch {}
    try { deepScanDb.exec(`ALTER TABLE competitor_reviews ADD COLUMN usage_context TEXT`); } catch {}
    try { deepScanDb.exec(`ALTER TABLE competitor_reviews ADD COLUMN purchase_intent TEXT`); } catch {}
    try { deepScanDb.exec(`ALTER TABLE competitor_reviews ADD COLUMN comparison_verdict TEXT`); } catch {}
    try { deepScanDb.exec(`ALTER TABLE competitor_alerts ADD COLUMN severity TEXT`); } catch {}
    try { deepScanDb.exec(`ALTER TABLE competitor_alerts ADD COLUMN opportunity_type TEXT`); } catch {}
    // Classify existing competitors
    const competitorSeed: Array<[string, string, string, string, string]> = [
      // Existing — re-classify
      ['pabloluna_tattoo', 'artist', 'manual', 'Pablo Luna — tattoo artist (not supply)'],
      ['bishoprotary', 'supply_brand', 'equipment_machine', 'Bishop Rotary — premium rotary tattoo machines'],
      ['cheyenne_tattooequipment', 'supply_brand', 'equipment_machine', 'Cheyenne — professional tattoo equipment (Hawk, Sol)'],
      // fkironsofficial — account deleted/not found, removed 2026-05-19
      ['kwadron', 'supply_brand', 'equipment_needle', 'Kwadron — premium tattoo cartridges and needles'],
      ['worldfamousink', 'supply_brand', 'supply_ink', 'World Famous Ink — tattoo ink brand'],
      ['inkjecta', 'supply_brand', 'equipment_machine', 'Inkjecta — Australian rotary machines'],
      ['davincitattoomachines', 'supply_brand', 'equipment_machine', 'Da Vinci — rotary and coil machines'],
      ['tatsoul', 'supply_distributor', 'supply_general', 'Tatsoul — tattoo furniture and accessories distributor'],
      ['hustlebutter', 'supply_brand', 'supply_aftercare', 'Hustle Butter — tattoo aftercare and balm'],
      ['madrabbit', 'supply_brand', 'supply_aftercare', 'Mad Rabbit — tattoo aftercare brand'],
      // New — equipment_machine
      ['dragonhawkofficial', 'supply_brand', 'equipment_machine', 'Dragonhawk — wireless tattoo pen machines (82K+ followers)'],
      ['masttattoo.official', 'supply_brand', 'equipment_machine', 'MAST TATTOO — wireless pen machines, sister brand to Dragonhawk'],
      ['ambitiontattoo', 'supply_brand', 'equipment_machine', 'Ambition — affordable wireless tattoo machines (Zhejiang, China)'],
      // New — equipment_needle
      ['peakneedles', 'supply_brand', 'equipment_needle', 'Peak Needles — Stellar/Quartz/Blood/Onyx/Triton cartridge needles'],
      // New — supply_ink
      ['intenzetattooink', 'supply_brand', 'supply_ink', 'Intenze — premium tattoo ink, New Jersey USA (founded 2005)'],
      ['dynamiccolor', 'supply_brand', 'supply_ink', 'Dynamic Color — tattoo ink since 1990, Ganga Black series'],
      ['eternalink', 'supply_brand', 'supply_ink', 'Eternal Ink — one of the "big three" tattoo ink brands'],
      ['kurosumitattooink', 'supply_brand', 'supply_ink', 'Kuro Sumi — Japanese-style tattoo ink brand'],
      ['fusion_ink', 'supply_brand', 'supply_ink', 'Fusion Ink — premium tattoo pigment brand'],
      // New — supply_general (distributors)
      ['painfulpleasures', 'supply_distributor', 'supply_general', 'Painful Pleasures — major US tattoo supply distributor (est. 1999, Hanover MD)'],
      ['kingpintattoosupply', 'supply_distributor', 'supply_general', 'Kingpin Tattoo Supply — St. Petersburg FL, ~74K IG followers (est. 1996)'],
      ['barber_dts', 'supply_distributor', 'supply_general', 'Barber DTS — UK/EU tattoo supply distributor'],
      // New — supply_aftercare
      ['tattoogoo', 'supply_brand', 'supply_aftercare', 'Tattoo Goo — tattoo aftercare and healing products'],
      ['h2ocean', 'supply_brand', 'supply_aftercare', 'H2Ocean — tattoo/piercing aftercare sea salt spray'],
    ];
    const now = Date.now();
    const upsertCompetitor = deepScanDb.prepare(`
      INSERT INTO content_competitors (handle, account_type, source, notes, platform, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'instagram', 1, ?, ?)
      ON CONFLICT(handle) DO UPDATE SET
        account_type = COALESCE(excluded.account_type, content_competitors.account_type),
        source = COALESCE(excluded.source, content_competitors.source),
        notes = COALESCE(excluded.notes, content_competitors.notes),
        updated_at = excluded.updated_at
    `);
    for (const [handle, accountType, source, notes] of competitorSeed) {
      upsertCompetitor.run(handle, accountType, source, notes, now, now);
    }
    console.log(`[migration] content_competitors seeded/updated: ${competitorSeed.length} records`);

    // ========== API Routes ==========
    const scrapeTasks = new Map<string, {
      id: string;
      status: string;
      completed: number;
      total: number;
      logs: string[];
      createdAt: number;
      shopsSaved: number;
      lastOutputAt?: number;
      cityList?: string[];
      completedCities?: string[];
      state?: string;
      country?: string;
      keyword?: string;
      cdpUrl?: string;
      headless?: boolean;
      parentTaskId?: string;
      autoResume?: boolean;
      resumeDepth?: number;
    }>();
    const scrapeProcesses = new Map<string, any>();

    setInterval(() => {
      for (const task of scrapeTasks.values()) {
        saveScrapeTask(task);
      }
    }, 3000);

    // ---------- 鎶撳彇鐩稿叧鎺ュ彛 ----------
    // 鍘熸湁鐨?TypeScript 鎶撳彇锛堜繚鐣欙級
    app.post('/api/scrape/start', async (req, res) => {
      const { state, cities, headless, keyword, country, cdpUrl } = req.body;
      if (!state) return res.status(400).json({ error: 'Missing state code' });

      const taskId = `scrape_${Date.now()}`;
      const task = { id: taskId, status: 'running', completed: 0, total: 0, logs: [], createdAt: Date.now(), shopsSaved: 0 };
      scrapeTasks.set(taskId, task);
      saveScrapeTask(task);

      (async () => {
        try {
          const total = await scrapeState(state, cities, headless ?? true, keyword || 'Tattoo Shops', country || 'USA', (completed, total) => {
            const t = scrapeTasks.get(taskId);
            if (t) { t.completed = completed; t.total = total; }
          });
          const t = scrapeTasks.get(taskId);
          if (t) { t.status = 'completed'; t.completed = t.total; }
        } catch (e: any) {
          const t = scrapeTasks.get(taskId);
          if (t) { t.status = 'failed'; }
          console.error('鎶撳彇澶辫触:', e);
        }
      })();

      res.json({ taskId });
    });

    // ---------- 鍏ㄦ柊鐨?Python 鎶撳彇鎺ュ彛锛堣皟鐢ㄥ閮ㄨ剼鏈級 ----------
    const startPythonScrapeTask = async (params: {
      state: string;
      cityList: string[];
      headless: boolean;
      keyword: string;
      country: string;
      cdpUrl: string;
      parentTaskId?: string;
      autoResume?: boolean;
      resumeDepth?: number;
    }) => {
      const { state, cityList, headless, keyword, country, cdpUrl, parentTaskId, autoResume = true, resumeDepth = 0 } = params;
      const taskId = `py_${Date.now()}`;
      const task = {
        id: taskId,
        status: 'running',
        completed: 0,
        total: cityList.length,
        logs: [],
        createdAt: Date.now(),
        shopsSaved: 0,
        lastOutputAt: Date.now(),
        cityList: [...cityList],
        completedCities: [] as string[],
        state,
        country,
        keyword,
        cdpUrl,
        headless,
        parentTaskId,
        autoResume,
        resumeDepth
      };
      scrapeTasks.set(taskId, task);
      saveScrapeTask(task);

      const pythonScriptPath = path.join(__dirname, 'scripts', 'python_scraper.py');
      if (!fs.existsSync(pythonScriptPath)) {
        task.status = 'failed';
        task.logs.push('Python script not found at scripts/python_scraper.py');
        scrapeTasks.set(taskId, task);
        saveScrapeTask(task);
        throw new Error('Python scraper not found');
      }

      const pythonProcess = spawn('python', [
        '-u',
        pythonScriptPath,
        '--state', state,
        '--country', country || 'USA',
        '--cities', JSON.stringify(cityList),
        '--headless', headless ? 'true' : 'false',
        '--keyword', keyword || 'Tattoo Shops',
        '--task-id', taskId,
        '--cdp-url', String(cdpUrl || 'http://127.0.0.1:9222')
      ], {
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          NEON_DATABASE_URL: DATABASE_URL
        }
      });
      scrapeProcesses.set(taskId, pythonProcess);

      pythonProcess.stdout.on('data', (data) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          const hb = scrapeTasks.get(taskId);
          if (hb) hb.lastOutputAt = Date.now();
          try {
            const json = JSON.parse(line);
            if (json.type === 'progress') {
              const t = scrapeTasks.get(taskId);
              if (t) {
                t.completed = json.current;
                t.total = json.total;
                t.logs.push(`${json.city}: found ${json.shops_found || 0} shops`);
                if (json.phase === 'end' && json.city) {
                  const c = String(json.city);
                  if (!Array.isArray(t.completedCities)) t.completedCities = [];
                  if (!t.completedCities.includes(c)) t.completedCities.push(c);
                }
                saveScrapeTask(t);
              }
            } else if (json.type === 'done') {
              const t = scrapeTasks.get(taskId);
              if (t) {
                t.status = 'completed';
                t.logs.push(`All done. Total shops: ${json.total_shops}`);
                saveScrapeTask(t);
              }
            } else if (json.type === 'log') {
              const t = scrapeTasks.get(taskId);
              if (t) {
                t.logs.push(json.message);
                saveScrapeTask(t);
              }
            } else if (json.type === 'shop') {
              const t = scrapeTasks.get(taskId);
              if (t) {
                t.shopsSaved += 1;
                saveScrapeTask(t);
              }
              void sql`
                INSERT INTO scraped_shops (
                  city, shop_name, address, phone, website,
                  instagram, facebook, tiktok, email, place_id, task_id
                ) VALUES (
                  ${String(json.city || '')},
                  ${String(json.shop_name || '')},
                  ${String(json.address || '')},
                  ${String(json.phone || '')},
                  ${String(json.website || '')},
                  ${String(json.instagram || '')},
                  ${String(json.facebook || '')},
                  ${String(json.tiktok || '')},
                  ${String(json.email || '')},
                  ${String(json.id || '')},
                  ${taskId}
                )
                ON CONFLICT (place_id, shop_name, address) DO UPDATE SET
                  phone = EXCLUDED.phone,
                  website = EXCLUDED.website,
                  instagram = COALESCE(NULLIF(EXCLUDED.instagram, ''), scraped_shops.instagram),
                  facebook = COALESCE(NULLIF(EXCLUDED.facebook, ''), scraped_shops.facebook),
                  tiktok = COALESCE(NULLIF(EXCLUDED.tiktok, ''), scraped_shops.tiktok),
                  email = COALESCE(NULLIF(EXCLUDED.email, ''), scraped_shops.email),
                  scraped_at = NOW()
              `.catch((e) => {
                const tt = scrapeTasks.get(taskId);
                if (tt) tt.logs.push(`DB upsert error: ${String(e?.message || e)}`);
              });
            } else if (json.type === 'error') {
              const t = scrapeTasks.get(taskId);
              if (t) {
                t.logs.push(`ERROR: ${json.message}`);
                saveScrapeTask(t);
              }
            }
          } catch {
            const t = scrapeTasks.get(taskId);
            if (t) {
              t.logs.push(line);
              saveScrapeTask(t);
            }
          }
        }
      });

      pythonProcess.stderr.on('data', (data) => {
        const t = scrapeTasks.get(taskId);
        if (t) {
          t.logs.push(`stderr: ${data.toString().trim()}`);
          t.lastOutputAt = Date.now();
          saveScrapeTask(t);
        }
      });

      pythonProcess.on('error', (err) => {
        const t = scrapeTasks.get(taskId);
        if (t) {
          t.status = 'interrupted';
          t.logs.push(`Spawn error: ${String(err?.message || err)}`);
          saveScrapeTask(t);
        }
      });

      const startAt = Date.now();
      const watchdog = setInterval(() => {
        const t = scrapeTasks.get(taskId);
        if (!t) return;
        if (t.status !== 'running') {
          clearInterval(watchdog);
          return;
        }
        const now = Date.now();
        const lastOutputAt = t.lastOutputAt || startAt;
        const idleMs = now - lastOutputAt;
        const progressedToEnd = t.total > 0 && t.completed >= t.total;
        if (progressedToEnd && idleMs > 45000) {
          t.status = 'completed';
          t.logs.push('Task auto-closed after completion heartbeat timeout.');
          saveScrapeTask(t);
          try { pythonProcess.kill(); } catch {}
          clearInterval(watchdog);
          return;
        }
        if (idleMs > 420000) {
          t.status = 'interrupted';
          t.logs.push('No scraper output for 420s; task marked interrupted.');
          saveScrapeTask(t);
          try { pythonProcess.kill(); } catch {}
          clearInterval(watchdog);
        }
      }, 5000);

      pythonProcess.on('close', (code) => {
        clearInterval(watchdog);
        scrapeProcesses.delete(taskId);
        const t = scrapeTasks.get(taskId);
        if (t) {
          if (code !== 0 && t.status === 'running') {
            t.status = 'interrupted';
            t.logs.push(`Python process exited with code ${code}`);
          } else if (t.status === 'running') {
            t.status = 'completed';
          }
          saveScrapeTask(t);
          const isInterrupted = t.status === 'interrupted';
          const canAutoResume = Boolean(t.autoResume) && Number(t.resumeDepth || 0) < 20;
          if (isInterrupted && canAutoResume && Array.isArray(t.cityList)) {
            const done = new Set(Array.isArray(t.completedCities) ? t.completedCities : []);
            const remainingCities = t.cityList.filter((c: string) => !done.has(String(c)));
            if (remainingCities.length > 0) {
              setTimeout(() => {
                void startPythonScrapeTask({
                  state: String(t.state || ''),
                  cityList: remainingCities,
                  headless: Boolean(t.headless ?? false),
                  keyword: String(t.keyword || 'Tattoo Shops'),
                  country: String(t.country || 'USA'),
                  cdpUrl: String(t.cdpUrl || 'http://127.0.0.1:9222'),
                  parentTaskId: String(t.id),
                  autoResume: Boolean(t.autoResume),
                  resumeDepth: Number(t.resumeDepth || 0) + 1
                }).catch(() => {});
              }, 1500);
            }
          }
        }
      });
      return taskId;
    };

    app.post('/api/scrape/python', async (req, res) => {
      try {
        const { state, cities, headless, keyword, country, cdpUrl, autoResume } = req.body;
        const cityList = Array.isArray(cities)
          ? cities.map((c: any) => String(c || '').trim()).filter(Boolean)
          : String(cities || '')
              .split(/\r?\n|,/)
              .map((c) => c.trim())
              .filter(Boolean);
        if (!state || cityList.length === 0) {
          return res.status(400).json({ error: 'Missing state or cities' });
        }

        const runningTask = Array.from(scrapeTasks.values())
          .find((t: any) => t.status === 'running');
        if (runningTask) {
          return res.status(409).json({
            error: 'Another scrape task is already running',
            runningTaskId: runningTask.id
          });
        }

        const isHeadless = typeof headless === 'boolean' ? headless : false;
        const taskId = await startPythonScrapeTask({
          state,
          cityList,
          headless: isHeadless,
          keyword: keyword || 'Tattoo Shops',
          country: country || 'USA',
          cdpUrl: String(cdpUrl || 'http://127.0.0.1:9222'),
          autoResume: autoResume !== false
        });
        return res.json({ taskId });
      } catch (e: any) {
        console.error('[scrape/python] start failed:', e);
        return res.status(500).json({ error: 'Failed to start scrape task', details: e?.message || String(e) });
      }
    });

    app.post('/api/scrape/restart/:taskId', async (req, res) => {
      try {
        const runningTask = Array.from(scrapeTasks.values())
          .find((t: any) => t.status === 'running');
        if (runningTask) {
          return res.status(409).json({
            error: 'Another scrape task is already running',
            runningTaskId: runningTask.id
          });
        }

        const oldTask = scrapeTasks.get(req.params.taskId) || loadScrapeTask(req.params.taskId);
        if (!oldTask) return res.status(404).json({ error: 'Task not found' });
        const cityList = Array.isArray(oldTask.cityList) ? oldTask.cityList : [];
        const completedCities = new Set(Array.isArray(oldTask.completedCities) ? oldTask.completedCities : []);
        const remainingCities = cityList.filter((c: string) => !completedCities.has(String(c)));
        if (remainingCities.length === 0) {
          return res.status(400).json({ error: 'No remaining cities to resume' });
        }
        const taskId = await startPythonScrapeTask({
          state: String(oldTask.state || req.body?.state || ''),
          cityList: remainingCities,
          headless: Boolean(oldTask.headless ?? false),
          keyword: String(oldTask.keyword || 'Tattoo Shops'),
          country: String(oldTask.country || 'USA'),
          cdpUrl: String(oldTask.cdpUrl || 'http://127.0.0.1:9222'),
          parentTaskId: String(oldTask.id)
        });
        return res.json({
          taskId,
          resumedFrom: oldTask.id,
          totalRemaining: remainingCities.length
        });
      } catch (e: any) {
        console.error('[scrape/restart] failed:', e);
        return res.status(500).json({ error: 'Failed to restart scrape task', details: e?.message || String(e) });
      }
    });
        // 鍏朵粬鍘熸湁 API 璺敱锛堜繚鎸佸師鏍凤級
    app.get('/api/states', (req, res) => {
      const { country } = req.query;
      if (!country) return res.status(400).json({ error: '缂哄皯鍥藉浠ｇ爜' });
      const states = State.getStatesOfCountry(country as string);
      const normalized = states
        .map(s => ({ name: s.name, isoCode: s.isoCode }))
        .sort((a, b) => a.name.localeCompare(b.name));
      res.json({ states: normalized });
    });

    function normalizeCityName(city: string): string {
      return String(city || '')
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/\s*\([^)]*\)\s*/g, ' ')
        .replace(/[^a-zA-Z0-9\s.-]/g, '')
        .trim();
    }

    function loadGeoNamesUSStateCities(stateCode: string, minPopulation: number): string[] {
      if (!fs.existsSync(GEONAMES_US_CACHE)) {
        throw new Error(
          `GeoNames cache missing at ${GEONAMES_US_CACHE}. Run: python scripts/build_geonames_us_cache.py`
        );
      }
      const raw = fs.readFileSync(GEONAMES_US_CACHE, 'utf8');
      const parsed = JSON.parse(raw);
      const rows: Array<{ name: string; population?: number }> = Array.isArray(parsed?.states?.[stateCode])
        ? parsed.states[stateCode]
        : [];
      return rows
        .filter((r) => Number(r.population || 0) > minPopulation)
        .map((r) => normalizeCityName(r.name))
        .filter(Boolean);
    }

    app.post('/api/cities', async (req, res) => {
      try {
        const { state, stateCode, country = 'US', minPopulation = 500 } = req.body;
        if (!state) {
          return res.status(400).json({ error: 'Missing state' });
        }

        let resolvedStateCode = String(stateCode || '').trim().toUpperCase();
        if (!resolvedStateCode) {
          const st = State.getStatesOfCountry(String(country).toUpperCase())
            .find((s) => s.name.toLowerCase() === String(state).toLowerCase());
          if (st?.isoCode) resolvedStateCode = st.isoCode;
        }

        if (String(country).toUpperCase() !== 'US') {
          return res.status(400).json({ error: 'GeoNames single-source mode currently supports US only' });
        }
        if (!resolvedStateCode) {
          return res.status(400).json({ error: 'Missing state code' });
        }

        const minPop = Number(minPopulation) || 500;
        const cities = Array.from(new Set(loadGeoNamesUSStateCities(resolvedStateCode, minPop)))
          .sort((a, b) => a.localeCompare(b));
        res.json({
          success: true,
          cities,
          meta: {
            stateCode: resolvedStateCode,
            sources: {
              geonames: cities.length
            },
            minPopulation: minPop,
            total: cities.length
          }
        });
      } catch (error: any) {
        console.error('[Cities] Error:', error);
        res.status(500).json({ error: 'Failed to fetch cities', details: error.message });
      }
    });

    app.post('/api/scrape/resume/:taskId', async (req, res) => {
      const task = scrapeTasks.get(req.params.taskId);
      if (!task) return res.status(404).json({ error: 'Task not found' });
      if (task.status !== 'paused') {
        return res.status(400).json({ error: 'Task is not paused' });
      }
      task.status = 'running';
      task.logs.push('Task resumed');
      res.json(task);
    });

    app.post('/api/scrape/pause/:taskId', (req, res) => {
      const task = scrapeTasks.get(req.params.taskId);
      if (!task) return res.status(404).json({ error: 'Task not found' });
      task.status = 'paused';
      task.logs.push('Task paused');
      res.json(task);
    });

    app.post('/api/scrape/cancel/:taskId', async (req, res) => {
      const { taskId } = req.params;
      const task = scrapeTasks.get(taskId) || loadScrapeTask(taskId);
      if (!task) return res.status(404).json({ error: 'Task not found' });

      const proc = scrapeProcesses.get(taskId);
      let killed = false;
      if (proc && proc.pid) {
        try {
          proc.kill();
          killed = true;
        } catch {}
        try {
          const killer = spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F']);
          killer.on('error', () => {});
          killed = true;
        } catch {}
        scrapeProcesses.delete(taskId);
      }

      task.status = 'cancelled';
      task.logs = Array.isArray(task.logs) ? task.logs : [];
      task.logs.push('Task cancelled by user.');
      saveScrapeTask(task);
      if (scrapeTasks.has(taskId)) {
        scrapeTasks.set(taskId, task);
      }

      return res.json({ ok: true, taskId, killed });
    });

    app.get('/api/scrape/status/:taskId', (req, res) => {
      const task = scrapeTasks.get(req.params.taskId) || loadScrapeTask(req.params.taskId);
      if (!task) return res.status(404).json({ error: 'Task not found' });
      res.json(task);
    });

    app.get('/api/scrape/results/:taskId', async (req, res) => {
      const { taskId } = req.params;
      const limitRaw = Number(req.query?.limit);
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(500, Math.floor(limitRaw)) : 200;
      try {
        const rows = await Promise.race([
          sql`
            SELECT city, shop_name, address, phone, website, instagram, facebook, email, place_id, scraped_at
            FROM scraped_shops
            WHERE task_id = ${taskId}
            ORDER BY scraped_at DESC
            LIMIT ${limit}
          `,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('scrape_results_timeout')), 12000)
          )
        ]);
        return res.json({ taskId, total: rows.length, rows });
      } catch (e: any) {
        const task = scrapeTasks.get(taskId) || loadScrapeTask(taskId);
        return res.json({
          taskId,
          total: 0,
          rows: [],
          warning: 'results_temporarily_unavailable',
          details: e?.message || String(e),
          shopsSaved: Number((task as any)?.shopsSaved || 0)
        });
      }
    });

    app.get('/api/scrape/export/:taskId', async (req, res) => {
      const { taskId } = req.params;
      try {
        const rows = await sql`
          SELECT city, shop_name, address, phone, website, instagram, facebook, tiktok, email, place_id, scraped_at
          FROM scraped_shops
          WHERE task_id = ${taskId}
          ORDER BY scraped_at
        `;
        if (rows.length === 0) {
          return res.status(404).json({ error: 'No data found for this task' });
        }
        const columns = ['city', 'shop_name', 'address', 'phone', 'website', 'instagram', 'facebook', 'tiktok', 'email', 'place_id', 'scraped_at'];
        const csvRows = [columns.join(',')];
        for (const row of rows) {
          const values = columns.map(col => {
            let val = row[col] || '';
            if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) {
              val = `"${val.replace(/"/g, '""')}"`;
            }
            return val;
          });
          csvRows.push(values.join(','));
        }
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="scrape_${taskId}.csv"`);
        res.send(csvRows.join('\n'));
      } catch (err) {
        console.error('Export error:', err);
        res.status(500).json({ error: 'Failed to export data' });
      }
    });

    // 浠诲姟鍒楄〃鎺ュ彛锛堝幓閲嶅悗淇濈暀涓€涓級
    app.get('/api/scrape/tasks', (req, res) => {
      const memTasks = Array.from(scrapeTasks.values());
      const dbTasks = listScrapeTasks(300);
      const byId = new Map<string, any>();
      dbTasks.forEach((t: any) => byId.set(String(t.id), t));
      memTasks.forEach((t: any) => byId.set(String(t.id), t));
      const tasks = Array.from(byId.values()).map((task: any) => ({
        id: task.id,
        status: task.status,
        completed: task.completed,
        total: task.total,
        shopsSaved: task.shopsSaved || 0,
        createdAt: task.createdAt || (task.id.includes('_') ? parseInt(task.id.split('_')[1]) : Date.now())
      }));
      tasks.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      res.json(tasks);
    });

    app.get('/api/health', (req, res) => {
      res.json({ status: 'ok', message: 'HarvestsAI Server is running' });
    });

    app.get('/api/debug/buckeye', async (req, res) => {
      try {
        const rows = await sql`SELECT id, shop_name, city, source_type, import_region, ig_handle, address, phone, last_updated FROM artists WHERE LOWER(shop_name) LIKE '%buckeye%' LIMIT 10`;
        return res.json({ ok: true, count: rows.length, rows });
      } catch (e: any) {
        return res.status(500).json({ error: String(e?.message || e) });
      }
    });

    app.get('/api/system/status', (req, res) => {
      const tasks = Array.from(scrapeTasks.values());
      const running = tasks.filter((t) => t.status === 'running').length;
      const interrupted = tasks.filter((t) => t.status === 'interrupted').length;
      return res.json({
        api: 'online',
        scrape: {
          running,
          interrupted,
          totalInMemory: tasks.length,
          activeProcesses: scrapeProcesses.size
        },
        now: new Date().toISOString()
      });
    });

    // ========== CSV 批量导入 (前台上传) ==========
    app.post('/api/artists/bulk-import', async (req, res) => {
      try {
        const { rows, importRegion, defaultCountry } = req.body;
        if (!Array.isArray(rows) || rows.length === 0) {
          return res.status(400).json({ error: 'rows must be a non-empty array' });
        }
        const region = (importRegion || '').trim().toUpperCase() || undefined;
        const country = (defaultCountry || '').trim() || 'USA';

        const IG_SYSTEM_PATHS = new Set([
          'meta', 'p', 'reel', 'reels', 'stories', 'tv', 'explore', 'about', 'ar',
          'api', 'developer', 'legal', 'accounts', 'business', 'help', 'settings',
        ]);

        function cleanIgHandle(val: string): string | null {
          if (!val || val === 'N/A') return null;
          const m = val.match(/instagram\.com\/([a-zA-Z0-9._-]+)/);
          if (m) {
            const h = m[1].toLowerCase();
            if (IG_SYSTEM_PATHS.has(h) || h.length <= 1) return null;
            return h;
          }
          let h = val.replace(/^@/, '').replace(/[^\w.]/g, '');
          if (!h || IG_SYSTEM_PATHS.has(h) || h.length <= 1) return null;
          return h;
        }
        function shopNameFromHandle(handle: string | null): string {
          if (!handle) return 'Unknown Shop';
          return handle.replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 180);
        }

        let inserted = 0;
        let updated = 0;
        let skipped = 0;

        for (const r of rows) {
          const name = String(r.name || r.shopName || r.shop_name || '').trim();
          const igRaw = String(r.ig_handle || r.instagram || r.ig_url || '');
          const igHandle = cleanIgHandle(igRaw);

          // Require at least shop_name OR ig_handle
          if ((!name || name === 'Unknown Shop') && !igHandle) {
            skipped++;
            continue;
          }

          const address = String(r.address || r.full_address || '').trim();
          const phone = String(r.phone || r.phone_number || '').replace(/\D/g, '');
          const email = String(r.email || '').trim();
          const city = String(r.city || r.location || '').trim();
          const website = String(r.website || r.site || '').trim();
          const facebook = String(r.facebook || r.facebook_id || '').trim();
          const tiktok = String(r.tiktok || '').trim();
          const rating = parseFloat(r.rating || r.mapsRating || '0') || 0;
          const reviews = parseInt(r.reviews || '0', 10) || 0;
          const followers = parseInt(r.followers || r.follower_count || '0', 10) || 0;

          const raw = `${name}_${address}_${phone}`.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
          // Use igHandle as fallback ID when no name
          const shopId = raw.length > 3 ? raw.slice(0, 120) : (igHandle ? `ig_${igHandle}` : `shop_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);

          // Safe dedup: exact id -> ig_handle only (never match by name alone - corrupts data)
          let matchId: string | null = null;
          {
            const r = await sql`SELECT id FROM artists WHERE id = ${shopId} LIMIT 1`;
            if (r.length > 0) matchId = r[0].id;
          }
          if (!matchId && igHandle) {
            const r = await sql`SELECT id FROM artists WHERE LOWER(ig_handle) LIKE ${'%' + igHandle.toLowerCase() + '%'} LIMIT 1`;
            if (r.length > 0) matchId = r[0].id;
          }

          if (matchId) {
            await sql`
              UPDATE artists SET
                full_name = ${name}, shop_name = ${name},
                address = ${address || null}, phone = ${phone || null},
                website = ${website || null}, ig_handle = ${igHandle},
                tiktok = ${tiktok || null}, facebook = ${facebook || null}, email = ${email || null},
                reviews = ${reviews}, rating = ${rating > 0 ? rating : null},
                followers = ${followers || null},
                source_type = COALESCE(source_type, 'csv_import'),
                last_updated = NOW()
              WHERE id = ${matchId}
            `;
            updated++;
          } else {
            await sql`
              INSERT INTO artists (id, uid, username, full_name, shop_name, stage,
                rating, reviews, followers, address, phone, website, ig_handle,
                tiktok, facebook, email, city, source_type, entity_type, import_region, last_updated)
              VALUES (${shopId}, ${shopId}, ${(name || igHandle || 'shop').replace(/\s+/g, '_').toLowerCase().slice(0, 60)},
                ${name || shopNameFromHandle(igHandle) || igHandle}, ${name || shopNameFromHandle(igHandle) || igHandle}, 'outreach', ${rating > 0 ? rating : 0}, ${reviews},
                ${followers || null},
                ${address || null}, ${phone || null}, ${website || null},
                ${igHandle}, ${tiktok || null}, ${facebook || null}, ${email || null},
                ${city || null}, 'csv_import', 'tattoo_shop', ${region || null}, NOW())
            `;
            inserted++;
          }
        }

        res.json({ ok: true, inserted, updated, skipped, total: rows.length });
      } catch (e: any) {
        console.error('bulk-import error:', e);
        res.status(500).json({ error: 'bulk_import_failed', detail: e?.message || String(e) });
      }
    });

    // GET /api/artists — bulk read from Neon (primary data source for frontend)
    app.get('/api/artists', async (req, res) => {
      try {
        const { state } = req.query;
        const rows = await (state
          ? sql`SELECT * FROM artists WHERE import_region = ${String(state)} ORDER BY shop_name`
          : sql`SELECT * FROM artists ORDER BY import_region, shop_name`
        );
        res.json(rows);
      } catch (e: any) {
        res.status(500).json({ error: String(e?.message || e) });
      }
    });

    app.get('/api/export/artists/:state', async (req, res) => {
      const { state } = req.params;
      try {
        const rows = await sql`
          SELECT city, shop_name, address, phone, website, ig_handle AS instagram, facebook, tiktok, email, reviews, last_updated
          FROM artists
          WHERE source_type IN ('maps_scrape', 'csv_import') AND import_region = ${state}
          ORDER BY city, shop_name
        `;
        if (rows.length === 0) return res.status(404).json({ error: 'No data for this state' });
        const columns = ['city', 'shop_name', 'address', 'phone', 'website', 'instagram', 'facebook', 'tiktok', 'email', 'reviews', 'last_updated'];
        const csvRows = [columns.join(',')];
        for (const row of rows) {
          const values = columns.map(col => {
            let val = row[col] || '';
            if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) {
              val = `"${val.replace(/"/g, '""')}"`;
            }
            return val;
          });
          csvRows.push(values.join(','));
        }
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="artists_${state}.csv"`);
        res.send(csvRows.join('\n'));
      } catch (err) {
        console.error('Export error:', err);
        res.status(500).json({ error: 'Export failed' });
      }
    });

    app.post('/api/inventory/source/load', async (req, res) => {
      try {
        const mode = String(req.body?.mode || '').trim().toLowerCase();
        const value = String(req.body?.value || '').trim();
        if (!mode || !value) {
          return res.status(400).json({ error: 'mode and value are required' });
        }

        let csvText = '';
        if (mode === 'file') {
          const resolved = path.resolve(value);
          if (!fs.existsSync(resolved)) {
            return res.status(404).json({ error: `File not found: ${resolved}` });
          }
          csvText = fs.readFileSync(resolved, 'utf-8');
        } else if (mode === 'url') {
          const resp = await fetch(value, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) InkFlow/1.0'
            }
          });
          if (!resp.ok) {
            const text = await resp.text();
            return res.status(400).json({ error: `Failed to load url: ${resp.status} ${text.slice(0, 160)}` });
          }
          csvText = await resp.text();
        } else {
          return res.status(400).json({ error: 'mode must be file or url' });
        }

        const { rows, headers } = parseCsvRows(csvText);
        return res.json({
          ok: true,
          mode,
          rows,
          headers,
          totalRows: rows.length,
          loadedAt: new Date().toISOString()
        });
      } catch (e: any) {
        return res.status(500).json({ error: e?.message || 'Failed to load inventory source' });
      }
    });

    app.post('/api/shopify/inventory/sync', async (req, res) => {
      try {
        const storeDomain = normalizeShopDomain(String(req.body?.storeDomain || ''));
        const accessToken = String(req.body?.accessToken || '').trim();
        const locationId = String(req.body?.locationId || '').trim();

        if (!storeDomain || !storeDomain.includes('.myshopify.com')) {
          return res.status(400).json({ error: 'Valid storeDomain is required (e.g. xxx.myshopify.com)' });
        }
        if (!accessToken) {
          return res.status(400).json({ error: 'accessToken is required' });
        }

        const apiVersion = '2024-10';
        const products: ShopifyProduct[] = [];
        let nextUrl: string | null = `https://${storeDomain}/admin/api/${apiVersion}/products.json?limit=250&fields=id,title,vendor,product_type,variants`;

        while (nextUrl) {
          const resp = await shopifyFetch(nextUrl, accessToken);
          const payload = await resp.json();
          const batch = Array.isArray(payload?.products) ? payload.products as ShopifyProduct[] : [];
          products.push(...batch);
          nextUrl = parseNextLink(resp.headers.get('link'));
        }

        const variants: Array<{
          id: number;
          sku: string;
          name: string;
          category: string;
          vendor?: string;
          price?: number;
          inventoryItemId?: number;
          fallbackQty: number;
        }> = [];

        products.forEach((product) => {
          (product.variants || []).forEach((variant) => {
            const variantTitle = String(variant.title || '').trim();
            const sku = String(variant.sku || '').trim();
            const name = variantTitle && variantTitle.toLowerCase() !== 'default title'
              ? `${product.title} / ${variantTitle}`
              : product.title;
            variants.push({
              id: Number(variant.id),
              sku: sku || `VAR_${variant.id}`,
              name,
              category: String(product.product_type || 'General'),
              vendor: product.vendor ? String(product.vendor) : undefined,
              price: Number.isFinite(Number(variant.price)) ? Number(variant.price) : undefined,
              inventoryItemId: Number.isFinite(Number(variant.inventory_item_id)) ? Number(variant.inventory_item_id) : undefined,
              fallbackQty: Number.isFinite(Number(variant.inventory_quantity)) ? Number(variant.inventory_quantity) : 0
            });
          });
        });

        const inventoryItemIds = Array.from(new Set(
          variants.map((v) => v.inventoryItemId).filter((x): x is number => Number.isFinite(Number(x)))
        ));
        const availableByInventoryItem = new Map<number, number>();

        for (let i = 0; i < inventoryItemIds.length; i += 50) {
          const chunk = inventoryItemIds.slice(i, i + 50);
          const qs = new URLSearchParams({ inventory_item_ids: chunk.join(',') });
          if (locationId) qs.set('location_ids', locationId);
          const url = `https://${storeDomain}/admin/api/${apiVersion}/inventory_levels.json?${qs.toString()}`;
          const resp = await shopifyFetch(url, accessToken);
          const payload = await resp.json();
          const levels = Array.isArray(payload?.inventory_levels) ? payload.inventory_levels : [];
          levels.forEach((level: any) => {
            const invId = Number(level?.inventory_item_id);
            const available = Number(level?.available);
            if (!Number.isFinite(invId) || !Number.isFinite(available)) return;
            const prev = availableByInventoryItem.get(invId) || 0;
            availableByInventoryItem.set(invId, prev + available);
          });
        }

        const now = new Date().toISOString();
        const items = variants.map((variant) => {
          const stock = variant.inventoryItemId && availableByInventoryItem.has(variant.inventoryItemId)
            ? Number(availableByInventoryItem.get(variant.inventoryItemId) || 0)
            : variant.fallbackQty;
          return {
            id: `shopify_variant_${variant.id}`,
            sku: variant.sku,
            name: variant.name,
            category: variant.category || 'General',
            stock: Number.isFinite(stock) ? stock : 0,
            threshold: 5,
            price: variant.price,
            currency: 'USD',
            vendor: variant.vendor,
            source: 'shopify',
            updatedAt: now
          };
        });

        return res.json({
          totalProducts: products.length,
          totalVariants: variants.length,
          items
        });
      } catch (e: any) {
        return res.status(500).json({ error: e?.message || 'Shopify inventory sync failed' });
      }
    });

    // ========== Inventory System APIs ==========

    // Get current stock per SKU (computed from inbounds - outbounds)
    app.get('/api/inventory/stock', async (req, res) => {
      try {
        const rows = deepScanDb.prepare(`
          SELECT
            p.sku, p.name, p.category, p.vendor, p.unit, p.unit_price,
            p.reorder_point, p.reorder_qty, p.lead_time_days, p.moq, p.carton_qty,
            p.source,
            COALESCE((SELECT COALESCE(SUM(quantity), 0) FROM inventory_inbounds WHERE product_sku = p.sku), 0) as total_inbound,
            COALESCE((SELECT COALESCE(SUM(quantity), 0) FROM inventory_outbounds WHERE product_sku = p.sku), 0) as total_outbound,
            COALESCE((SELECT COALESCE(SUM(quantity), 0) FROM inventory_inbounds WHERE product_sku = p.sku), 0)
              - COALESCE((SELECT COALESCE(SUM(quantity), 0) FROM inventory_outbounds WHERE product_sku = p.sku), 0) as current_stock
          FROM inventory_products p
          ORDER BY p.sku
        `).all() as any[];

        const withStatus = rows.map((r: any) => ({
          ...r,
          status: r.current_stock === 0 ? 'out_of_stock'
            : r.current_stock <= r.reorder_point ? 'low_stock'
            : 'healthy'
        }));

        return res.json({ ok: true, items: withStatus });
      } catch (e: any) {
        return res.status(500).json({ error: e.message });
      }
    });

    // Create / update product
    app.post('/api/inventory/product', async (req, res) => {
      try {
        const body = req.body;
        const now = Date.now();
        const { sku, name, category, vendor, unit, unit_price, reorder_point, reorder_qty, lead_time_days, moq, carton_qty, source, shopify_variant_id, id } = body;

        if (id) {
          // Update existing
          deepScanDb.prepare(`
            UPDATE inventory_products SET
              name = ?, category = ?, vendor = ?, unit = ?, unit_price = ?,
              reorder_point = ?, reorder_qty = ?, lead_time_days = ?, moq = ?, carton_qty = ?,
              source = ?, shopify_variant_id = ?, updated_at = ?
            WHERE sku = ?
          `).run(name!, category || 'General', vendor || '', unit || 'Box', unit_price || 0,
            reorder_point || 50, reorder_qty || 1000, lead_time_days || 45, moq || 500, carton_qty || 100,
            source || 'manual', shopify_variant_id || null, now, sku);
          return res.json({ ok: true, action: 'updated', sku });
        } else {
          // Insert new
          deepScanDb.prepare(`
            INSERT INTO inventory_products (sku, name, category, vendor, unit, unit_price,
              reorder_point, reorder_qty, lead_time_days, moq, carton_qty, source, shopify_variant_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(sku!, name!, category || 'General', vendor || '', unit || 'Box', unit_price || 0,
            reorder_point || 50, reorder_qty || 1000, lead_time_days || 45, moq || 500, carton_qty || 100,
            source || 'manual', shopify_variant_id || null, now, now);
          return res.json({ ok: true, action: 'created', sku });
        }
      } catch (e: any) {
        if (e.message?.includes('UNIQUE')) {
          return res.status(409).json({ error: `SKU ${sku} already exists` });
        }
        return res.status(500).json({ error: e.message });
      }
    });

    // Delete product
    app.delete('/api/inventory/product/:sku', async (req, res) => {
      try {
        deepScanDb.prepare('DELETE FROM inventory_products WHERE sku = ?').run(req.params.sku);
        return res.json({ ok: true });
      } catch (e: any) {
        return res.status(500).json({ error: e.message });
      }
    });

    // Update a single product field (e.g. reorder_point)
    app.post('/api/inventory/product/:sku/field', async (req, res) => {
      try {
        const { field, value } = req.body;
        const allowed = ['name', 'category', 'vendor', 'unit', 'unit_price', 'reorder_point', 'reorder_qty', 'barcode', 'source'];
        if (!allowed.includes(field)) {
          return res.status(400).json({ error: `Field '${field}' not allowed` });
        }
        const now = Date.now();
        deepScanDb.prepare(`UPDATE inventory_products SET ${field} = ?, updated_at = ? WHERE sku = ?`)
          .run(value, now, req.params.sku);
        return res.json({ ok: true, updated: field, sku: req.params.sku });
      } catch (e: any) {
        return res.status(500).json({ error: e.message });
      }
    });

    // Record inbound (入库)
    app.post('/api/inventory/inbound', async (req, res) => {
      try {
        const { product_sku, quantity, po_number, inbound_date, note } = req.body;
        if (!product_sku || !quantity || !inbound_date) {
          return res.status(400).json({ error: 'product_sku, quantity, inbound_date required' });
        }
        const now = Date.now();
        deepScanDb.prepare(`
          INSERT INTO inventory_inbounds (product_sku, quantity, po_number, inbound_date, note, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(product_sku, quantity, po_number || '', inbound_date, note || '', now);

        // Record purchase history
        deepScanDb.prepare(`
          INSERT INTO purchase_history (product_sku, po_number, ordered_qty, received_qty,
            order_date, received_date, supplier, lead_time_days)
          VALUES (?, ?, ?, ?, ?, '', '', 0)
        `).run(product_sku, po_number || '', quantity, quantity, inbound_date);

        return res.json({ ok: true });
      } catch (e: any) {
        return res.status(500).json({ error: e.message });
      }
    });

    // Record outbound (出库)
    app.post('/api/inventory/outbound', async (req, res) => {
      try {
        const { product_sku, quantity, channel, customer_name, shopify_order_id, outbound_date, note } = req.body;
        if (!product_sku || !quantity || !channel || !outbound_date) {
          return res.status(400).json({ error: 'product_sku, quantity, channel, outbound_date required' });
        }
        if (!['B2C', 'B2B'].includes(channel)) {
          return res.status(400).json({ error: 'channel must be B2C or B2B' });
        }
        const now = Date.now();
        deepScanDb.prepare(`
          INSERT INTO inventory_outbounds (product_sku, quantity, channel, customer_name, shopify_order_id, outbound_date, note, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(product_sku, quantity, channel, customer_name || '', shopify_order_id || '', outbound_date, note || '', now);

        // Update customer if B2B
        if (channel === 'B2B' && customer_name) {
          deepScanDb.prepare(`
            INSERT INTO inventory_customers (name, updated_at)
            VALUES (?, ?)
            ON CONFLICT(name) DO UPDATE SET updated_at = ?
          `).run(customer_name, now, now);
        }

        return res.json({ ok: true });
      } catch (e: any) {
        return res.status(500).json({ error: e.message });
      }
    });

    // Get inbound records
    app.get('/api/inventory/inbounds', async (req, res) => {
      try {
        const rows = deepScanDb.prepare(`
          SELECT * FROM inventory_inbounds ORDER BY inbound_date DESC LIMIT 200
        `).all() as any[];
        return res.json({ ok: true, items: rows });
      } catch (e: any) {
        return res.status(500).json({ error: e.message });
      }
    });

    // Get outbound records
    app.get('/api/inventory/outbounds', async (req, res) => {
      try {
        const channel = req.query.channel as string;
        const sku = req.query.sku as string;
        let sql = 'SELECT * FROM inventory_outbounds WHERE 1=1';
        const params: any[] = [];
        if (channel && channel !== 'all') { sql += ' AND channel = ?'; params.push(channel); }
        if (sku) { sql += ' AND product_sku = ?'; params.push(sku); }
        sql += ' ORDER BY outbound_date DESC LIMIT 500';
        const rows = deepScanDb.prepare(sql).all(...params) as any[];
        return res.json({ ok: true, items: rows });
      } catch (e: any) {
        return res.status(500).json({ error: e.message });
      }
    });

    // Get all customers
    app.get('/api/inventory/customers', async (req, res) => {
      try {
        const rows = deepScanDb.prepare(`
          SELECT c.*,
            (SELECT COUNT(*) FROM inventory_outbounds WHERE customer_name = c.name AND channel = 'B2B') as b2b_order_count,
            (SELECT COALESCE(SUM(quantity), 0) FROM inventory_outbounds WHERE customer_name = c.name AND channel = 'B2B') as b2b_total_units
          FROM inventory_customers c
          ORDER BY c.total_spent DESC
        `).all() as any[];
        return res.json({ ok: true, items: rows });
      } catch (e: any) {
        return res.status(500).json({ error: e.message });
      }
    });

    // List distributor candidates from artists table (Neon)
    app.get('/api/inventory/distributor-candidates', async (_req, res) => {
      try {
        const rows = await sql`
          SELECT id, shop_name, full_name, username, bio, ig_handle, website, city, metadata
          FROM artists
          WHERE metadata->>'isDistributor' = 'true'
             OR LOWER(COALESCE(shop_name,'') || ' ' || COALESCE(full_name,'') || ' ' || COALESCE(bio,'')) LIKE '%distributor%'
             OR LOWER(COALESCE(shop_name,'') || ' ' || COALESCE(full_name,'') || ' ' || COALESCE(bio,'')) LIKE '%wholesale%'
             OR LOWER(COALESCE(shop_name,'') || ' ' || COALESCE(full_name,'') || ' ' || COALESCE(bio,'')) LIKE '%tattoo supply%'
          ORDER BY shop_name
          LIMIT 200
        `;
        return res.json({ ok: true, items: rows });
      } catch (e: any) {
        return res.status(500).json({ error: e.message });
      }
    });

    // Import distributor candidate into inventory_customers
    app.post('/api/inventory/import-distributor', async (req, res) => {
      try {
        const { artistId } = req.body;
        if (!artistId) return res.status(400).json({ error: 'artistId required' });
        const [artist] = await sql`SELECT * FROM artists WHERE id = ${artistId} LIMIT 1`;
        if (!artist) return res.status(404).json({ error: 'Artist not found' });
        const now = Date.now();
        deepScanDb.prepare(`
          INSERT INTO inventory_customers (name, email, instagram, country, customer_type, status, notes, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'Distributor', 'Lead', ?, ?, ?)
          ON CONFLICT(name) DO UPDATE SET instagram = EXCLUDED.instagram, updated_at = EXCLUDED.updated_at
        `).run(
          artist.shop_name || artist.full_name || artist.username || 'Unknown',
          '',
          artist.ig_handle || '',
          artist.city || '',
          `Imported from distributor board. IG: ${artist.ig_handle || ''} Bio: ${(artist.bio || '').slice(0, 100)}`,
          now, now
        );
        return res.json({ ok: true, name: artist.shop_name });
      } catch (e: any) {
        return res.status(500).json({ error: e.message });
      }
    });

    // Create/update customer
    app.post('/api/inventory/customer', async (req, res) => {
      try {
        const { id, name, email, instagram, country, customer_type, notes } = req.body;
        const now = Date.now();

        if (id) {
          deepScanDb.prepare(`
            UPDATE inventory_customers SET email=?, instagram=?, country=?, customer_type=?, notes=?, updated_at=?
            WHERE id=?
          `).run(email||'', instagram||'', country||'', customer_type||'Studio', notes||'', now, id);
        } else {
          deepScanDb.prepare(`
            INSERT INTO inventory_customers (name, email, instagram, country, customer_type, notes, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(name, email||'', instagram||'', country||'', customer_type||'Studio', notes||'', now, now);
        }
        return res.json({ ok: true });
      } catch (e: any) {
        return res.status(500).json({ error: e.message });
      }
    });

    // Stock alerts + reorder suggestions
    app.get('/api/inventory/alerts', async (req, res) => {
      try {
        // Get current stock with reorder suggestions
        const rows = deepScanDb.prepare(`
          SELECT
            p.sku, p.name, p.category, p.vendor, p.reorder_point, p.reorder_qty,
            p.lead_time_days, p.moq, p.carton_qty,
            COALESCE(inb.total_in, 0) as total_inbound,
            COALESCE(out.total_out, 0) as total_outbound,
            COALESCE(inb.total_in, 0) - COALESCE(out.total_out, 0) as current_stock
          FROM inventory_products p
          LEFT JOIN (
            SELECT product_sku, COALESCE(SUM(quantity), 0) as total_in
            FROM inventory_inbounds GROUP BY product_sku
          ) inb ON p.sku = inb.product_sku
          LEFT JOIN (
            SELECT product_sku, COALESCE(SUM(quantity), 0) as total_out
            FROM inventory_outbounds GROUP BY product_sku
          ) out ON p.sku = out.product_sku
          WHERE (COALESCE(inb.total_in, 0) - COALESCE(out.total_out, 0)) <= p.reorder_point
          ORDER BY current_stock ASC
        `).all() as any[];

        const alerts = rows.map((r: any) => {
          const current = r.current_stock;
          // Calculate daily avg from last 90 days
          const ninetyDaysAgo = new Date();
          ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
          const dateStr = ninetyDaysAgo.toISOString().split('T')[0];

          const dailyUsage = deepScanDb.prepare(`
            SELECT COALESCE(SUM(quantity), 0) as total FROM inventory_outbounds
            WHERE product_sku = ? AND outbound_date >= ?
          `).get(r.sku, dateStr) as any;

          const avgDaily = dailyUsage.total / 90;
          const leadTimeDays = r.lead_time_days || 45;
          const safetyDays = 15;
          const reorderPoint = (leadTimeDays + safetyDays) * avgDaily;

          // Suggested qty: cover 90 days + safety, rounded to MOQ multiple
          const suggestedCoverage = 90 + safetyDays;
          let suggestedQty = Math.ceil(suggestedCoverage * avgDaily);
          const moq = r.moq || 500;
          suggestedQty = Math.max(suggestedQty, moq);
          suggestedQty = Math.ceil(suggestedQty / moq) * moq; // round to MOQ multiple

          // Days until stockout
          const daysUntilEmpty = avgDaily > 0 ? Math.ceil(current / avgDaily) : 999;

          return {
            ...r,
            avg_daily_usage: Math.round(avgDaily * 100) / 100,
            suggested_reorder_qty: suggestedQty,
            days_until_empty: daysUntilEmpty,
            days_until_stockout_urgent: daysUntilEmpty <= 7 ? 'URGENT' : daysUntilEmpty <= 30 ? 'WARNING' : 'OK'
          };
        });

        return res.json({ ok: true, alerts });
      } catch (e: any) {
        return res.status(500).json({ error: e.message });
      }
    });

    // Sales trend analysis (last 90 days by SKU)
    app.get('/api/inventory/trends', async (req, res) => {
      try {
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
        const dateStr = ninetyDaysAgo.toISOString().split('T')[0];

        // Sales by SKU by month (last 3 months)
        const monthlySales = deepScanDb.prepare(`
          SELECT
            product_sku,
            strftime('%Y-%m', outbound_date) as month,
            SUM(quantity) as total_qty,
            COUNT(*) as order_count
          FROM inventory_outbounds
          WHERE outbound_date >= ?
          GROUP BY product_sku, strftime('%Y-%m', outbound_date)
          ORDER BY outbound_date DESC
        `).all(dateStr) as any[];

        // Slow-moving products (no outbound in last 60 days)
        const sixtyDaysAgo = new Date();
        sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
        const slowDateStr = sixtyDaysAgo.toISOString().split('T')[0];

        const activeSkus = new Set(
          deepScanDb.prepare(`
            SELECT DISTINCT product_sku FROM inventory_outbounds WHERE outbound_date >= ?
          `).all(slowDateStr) as any[]
        );

        const slowMovers = deepScanDb.prepare(`
          SELECT sku, name,
            (SELECT COALESCE(SUM(quantity),0) FROM inventory_inbounds WHERE product_sku=inventory_products.sku)
            - (SELECT COALESCE(SUM(quantity),0) FROM inventory_outbounds WHERE product_sku=inventory_products.sku) as current_stock
          FROM inventory_products
          WHERE sku NOT IN (
            SELECT DISTINCT product_sku FROM inventory_outbounds WHERE outbound_date >= ?
          )
        `).all(slowDateStr) as any[];

        return res.json({ ok: true, monthlySales, slowMovers });
      } catch (e: any) {
        return res.status(500).json({ error: e.message });
      }
    });

    // Create purchase order
    app.post('/api/inventory/po/create', async (req, res) => {
      try {
        const { items, supplier, expected_date, notes } = req.body;
        if (!items || !Array.isArray(items) || items.length === 0) {
          return res.status(400).json({ error: 'items array required' });
        }

        const now = Date.now();
        const today = new Date().toISOString().split('T')[0];
        const poNumber = `PO-${today.replace(/-/g, '')}-${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`;

        // Create PO
        deepScanDb.prepare(`
          INSERT INTO purchase_orders (po_number, supplier, status, order_date, expected_date, created_at, notes)
          VALUES (?, ?, 'draft', ?, ?, ?, ?)
        `).run(poNumber, supplier || '', today, expected_date || '', now, notes || '');

        const poId = deepScanDb.prepare('SELECT last_insert_rowid()').get() as any;
        const poInsertId = poId.last_insert_rowid as number;

        // Create PO items
        for (const item of items) {
          deepScanDb.prepare(`
            INSERT INTO purchase_order_items (po_id, product_sku, quantity, unit_cost)
            VALUES (?, ?, ?, ?)
          `).run(poInsertId, item.sku, item.quantity, item.unit_cost || 0);
        }

        return res.json({ ok: true, po_number: poNumber, po_id: poInsertId });
      } catch (e: any) {
        return res.status(500).json({ error: e.message });
      }
    });

    // Get purchase orders
    app.get('/api/inventory/po', async (req, res) => {
      try {
        const rows = deepScanDb.prepare(`
          SELECT po.*,
            (SELECT COALESCE(SUM(poi.quantity), 0) FROM purchase_order_items poi WHERE poi.po_id = po.id) as total_items
          FROM purchase_orders po
          ORDER BY po.order_date DESC
        `).all() as any[];
        return res.json({ ok: true, items: rows });
      } catch (e: any) {
        return res.status(500).json({ error: e.message });
      }
    });

    // Get purchase order items
    app.get('/api/inventory/po/:id/items', async (req, res) => {
      try {
        const rows = deepScanDb.prepare(`
          SELECT poi.*, p.name, p.sku, p.unit
          FROM purchase_order_items poi
          JOIN inventory_products p ON poi.product_sku = p.sku
          WHERE poi.po_id = ?
        `).all(Number(req.params.id)) as any[];
        return res.json({ ok: true, items: rows });
      } catch (e: any) {
        return res.status(500).json({ error: e.message });
      }
    });

    // Upload purchase history (bulk)
    app.post('/api/inventory/purchase-history/import', async (req, res) => {
      try {
        const { records } = req.body;
        if (!Array.isArray(records)) {
          return res.status(400).json({ error: 'records array required' });
        }
        const now = Date.now();
        let count = 0;
        for (const r of records) {
          try {
            deepScanDb.prepare(`
              INSERT INTO purchase_history (product_sku, po_number, ordered_qty, received_qty,
                order_date, received_date, supplier, lead_time_days)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(r.sku, r.po_number, r.ordered_qty, r.received_qty || 0,
              r.order_date, r.received_date || '', r.supplier || '', r.lead_time_days || 0);
            count++;
          } catch {}
        }
        return res.json({ ok: true, imported: count });
      } catch (e: any) {
        return res.status(500).json({ error: e.message });
      }
    });

    // Sync customers from Shopify orders
    app.post('/api/inventory/customers/sync', async (req, res) => {
      try {
        const { orders } = req.body;
        if (!Array.isArray(orders)) {
          return res.status(400).json({ error: 'orders array required' });
        }
        const now = Date.now();
        let count = 0;
        for (const order of orders) {
          const customerName = order.customer_name || order.shopify_customer_name || 'Unknown';
          deepScanDb.prepare(`
            INSERT INTO inventory_customers (name, email, last_order_date, first_order_date, total_orders, total_spent, updated_at)
            VALUES (?, ?, ?, ?, 1, ?, ?)
            ON CONFLICT(name) DO UPDATE SET
              total_orders = total_orders + 1,
              total_spent = total_spent + ?,
              last_order_date = ?,
              updated_at = ?
          `).run(customerName, order.customer_email || '', order.order_date || today(),
            order.order_date || today(), order.total_spent || 0,
            order.total_spent || 0, order.order_date || today(), now);
          count++;
        }
        return res.json({ ok: true, synced: count });
      } catch (e: any) {
        return res.status(500).json({ error: e.message });
      }
    });

    app.post('/api/enrich/social-links', async (req, res) => {
      const input = (req.body?.shops || []) as ShopLookupInput[];
      const shops = input.filter((s) => s && s.id).slice(0, 200);
      if (shops.length === 0) {
        return res.status(400).json({ error: 'No valid shops provided' });
      }

      try {
        const results: any[] = [];
        const concurrency = 8;
        for (let i = 0; i < shops.length; i += concurrency) {
          const chunk = shops.slice(i, i + concurrency);
          const chunkResults = await Promise.all(chunk.map(lookupSocialForShop));
          results.push(...chunkResults);
        }
        return res.json({ results });
      } catch (e: any) {
        return res.status(500).json({ error: e?.message || 'Lookup failed' });
      }
    });

    app.post('/api/instagram/validate', async (req, res) => {
      const rawUrl = String(req.body?.url || '').trim();
      const shopName = String(req.body?.shopName || '').trim();
      const shopType = String(req.body?.shopType || 'shop').trim().toLowerCase();
      const url = ensureHttp(rawUrl);
      if (!url || !url.toLowerCase().includes('instagram.com/')) {
        return res.status(400).json({ error: 'Valid instagram url is required' });
      }

      const html = await fetchText(url, 10000);
      if (!html) {
        return res.json({ ok: false, score: 0, verdict: 'low', reason: 'network_empty' });
      }

      const titleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]*)"/i);
      const descMatch = html.match(/<meta\s+property="og:description"\s+content="([^"]*)"/i);
      const bioMatch = html.match(/"biography":"([^"]*)"/i);
      const title = titleMatch?.[1] || '';
      const description = descMatch?.[1] || '';
      const biography = bioMatch?.[1] || '';

      const targetTokens = tokenize(shopName);
      const pageTokens = tokenize(`${title} ${description} ${biography}`);
      const shopOverlap = overlapScore(targetTokens, pageTokens);

      const distributorKeywords = ['supply', 'supplier', 'wholesale', 'distribution', 'distributor', 'equipment'];
      const tattooKeywords = ['tattoo', 'ink', 'needle', 'studio', 'artist'];
      const pageText = `${title} ${description} ${biography}`.toLowerCase();
      const distributorHit = distributorKeywords.some((k) => pageText.includes(k));
      const tattooHit = tattooKeywords.some((k) => pageText.includes(k));

      let score = shopOverlap * 0.65 + (tattooHit ? 0.2 : 0);
      if (shopType === 'distributor' && distributorHit) score += 0.2;
      score = Math.min(1, Math.max(0, score));

      const verdict = score >= 0.72 ? 'high' : score >= 0.45 ? 'medium' : 'low';
      return res.json({
        ok: verdict !== 'low',
        score: Number(score.toFixed(3)),
        verdict,
        signals: {
          title,
          description,
          biography: biography.slice(0, 200),
          shopOverlap: Number(shopOverlap.toFixed(3)),
          tattooHit,
          distributorHit
        }
      });
    });

    app.post('/api/deep-scan/start', (req, res) => {
      const artistIdsRaw = req.body?.artistIds;
      const batchSizeRaw = Number(req.body?.batchSize);
      const artistIds = Array.isArray(artistIdsRaw)
        ? Array.from(new Set(artistIdsRaw.map((id: any) => String(id)).filter(Boolean)))
        : [];
      if (artistIds.length === 0) {
        return res.status(400).json({ error: 'artistIds is required' });
      }

      const batchSize = Number.isFinite(batchSizeRaw) && batchSizeRaw > 0
        ? Math.min(200, Math.floor(batchSizeRaw))
        : 50;

      const task: DeepScanTask = {
        id: `dscan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'running',
        total: artistIds.length,
        batchSize,
        pendingIds: [...artistIds],
        leasedUntilById: {},
        completedIds: [],
        failedIds: [],
        failedReasonById: {},
        retryCountById: {},
        maxRetries: 2
      };
      saveDeepTask(task);
      return res.json({ taskId: task.id, ...toTaskStatus(task) });
    });

    app.post('/api/deep-scan/start-by-state', async (req, res) => {
      const state = String(req.body?.state || '').trim();
      const onlyMissingIg = req.body?.onlyMissingIg !== false;
      const onlyMissingSocial = req.body?.onlyMissingSocial === true;
      const limitRaw = Number(req.body?.limit);
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(20000, Math.floor(limitRaw)) : 5000;
      const batchSizeRaw = Number(req.body?.batchSize);
      const batchSize = Number.isFinite(batchSizeRaw) && batchSizeRaw > 0 ? Math.min(200, Math.floor(batchSizeRaw)) : 50;
      if (!state) {
        return res.status(400).json({ error: 'state is required' });
      }
      try {
        const missingWhere = onlyMissingSocial
          ? sql`
              (
                ig_handle IS NULL OR ig_handle = '' OR ig_handle = 'N/A'
                OR facebook IS NULL OR facebook = '' OR facebook = 'N/A'
                OR email IS NULL OR email = '' OR email = 'N/A'
                OR website IS NULL OR website = '' OR website = 'N/A'
              )
            `
          : sql`
              (
                ${onlyMissingIg} = false
                OR ig_handle IS NULL
                OR ig_handle = ''
                OR ig_handle = 'N/A'
              )
            `;
        const artists = await sql`
          SELECT id
          FROM artists
          WHERE source_type IN ('maps_scrape', 'csv_import')
            AND (
              import_region = ${state}
              OR import_region = ${state.toUpperCase()}
            )
            AND ${missingWhere}
          ORDER BY last_updated DESC NULLS LAST
          LIMIT ${limit}
        `;
        const artistIds = artists.map((x: any) => String(x.id)).filter(Boolean);
        if (artistIds.length === 0) {
          return res.status(404).json({ error: 'No artists found for deep scan in this state' });
        }
        const task: DeepScanTask = {
          id: `dscan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          status: 'running',
          total: artistIds.length,
          batchSize,
          pendingIds: [...artistIds],
          leasedUntilById: {},
          completedIds: [],
          failedIds: [],
          failedReasonById: {},
          retryCountById: {},
          maxRetries: 2
        };
        saveDeepTask(task);
        return res.json({
          taskId: task.id,
          selected: artistIds.length,
          filterMode: onlyMissingSocial ? 'missing_social_any' : (onlyMissingIg ? 'missing_ig_only' : 'all'),
          ...toTaskStatus(task)
        });
      } catch (e: any) {
        return res.status(500).json({ error: 'Failed to start deep scan by state', details: e?.message || String(e) });
      }
    });

    app.post('/api/automation/generate-from-artists', async (req, res) => {
      try {
        const state = String(req.body?.state || '').trim();
        const limitRaw = Number(req.body?.limit);
        const noFilter = req.body?.noFilter !== false; // default true: run as broad as possible
        const autoDeleteNonTattoo = req.body?.autoDeleteNonTattoo === true; // default false (safer)
        const dispatchMode = String(req.body?.dispatchMode || 'city_round_robin').trim().toLowerCase(); // newest | random | city_round_robin
        const batchByTimeWindow = req.body?.batchByTimeWindow !== false; // default true
        const nightMode = String(req.body?.nightMode || 'light_browse_only').trim().toLowerCase(); // light_browse_only | normal
        const minRatingRaw = Number(req.body?.minRating);
        const minReviewsRaw = Number(req.body?.minReviews);
        const behaviorProfile = String(req.body?.behaviorProfile || 'warmup');
        const likeRatioRaw = Number(req.body?.likeRatio);
        const accountId = String(req.body?.accountId || '').trim();
        const language = String(req.body?.language || 'en');
        const SAFE_DEFAULT_LIMIT = 20;
        const SAFE_MAX_LIMIT = 200;
        const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(SAFE_MAX_LIMIT, Math.floor(limitRaw)) : SAFE_DEFAULT_LIMIT;
        const minRating = noFilter ? 0 : (Number.isFinite(minRatingRaw) ? Math.max(0, minRatingRaw) : 4.0);
        const minReviews = noFilter ? 0 : (Number.isFinite(minReviewsRaw) ? Math.max(0, Math.floor(minReviewsRaw)) : 10);
        const now = Date.now();

        let artists: any[] = [];
        const withTimeout = async <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
          return await Promise.race([
            promise,
            new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label}_timeout_${ms}ms`)), ms))
          ]);
        };
        if (state) {
          artists = await withTimeout(sql`
            SELECT id, shop_name, ig_handle, rating, reviews, import_region, city, website, address
            FROM artists
            WHERE source_type IN ('maps_scrape', 'csv_import')
              AND (import_region = ${state} OR import_region = ${state.toUpperCase()})
              AND ig_handle IS NOT NULL
              AND ig_handle <> ''
              AND ig_handle <> 'N/A'
              AND COALESCE(rating, 0) >= ${minRating}
              AND COALESCE(reviews, 0) >= ${minReviews}
            ORDER BY last_updated DESC NULLS LAST, id DESC
            LIMIT ${limit}
          `, 15000, 'generate_artists_query');
        } else {
          artists = await withTimeout(sql`
            SELECT id, shop_name, ig_handle, rating, reviews, import_region, city, website, address
            FROM artists
            WHERE source_type IN ('maps_scrape', 'csv_import')
              AND ig_handle IS NOT NULL
              AND ig_handle <> ''
              AND ig_handle <> 'N/A'
              AND COALESCE(rating, 0) >= ${minRating}
              AND COALESCE(reviews, 0) >= ${minReviews}
            ORDER BY last_updated DESC NULLS LAST, id DESC
            LIMIT ${limit}
          `, 15000, 'generate_artists_query');
        }

        const nonTattooRows = artists.filter((a: any) => !isTattooEntity(a));
        if (autoDeleteNonTattoo && nonTattooRows.length > 0) {
          const nonTattooIds = nonTattooRows.map((x: any) => String(x.id || '')).filter(Boolean);
          if (nonTattooIds.length > 0) {
            await sql`DELETE FROM artists WHERE id = ANY(${nonTattooIds}::text[])`;
            const delTaskStmt = deepScanDb.prepare(`
              DELETE FROM automation_tasks
              WHERE json_extract(payload, '$.artistId') = ?
                AND status IN ('pending','leased','running')
            `);
            for (const id of nonTattooIds) delTaskStmt.run(id);
          }
        }
        // When querying by state from maps_scrape, all results are pre-filtered by Maps keyword search.
        // Only apply tattoo entity filter when autoDeleteNonTattoo is explicitly enabled (cleanup mode).
        if (autoDeleteNonTattoo) {
          artists = artists.filter((a: any) => isTattooEntity(a));
        }
        // Soft gate: log suspicious handles but don't exclude — Maps pre-filtering is sufficient
        const nonTattooHandles = artists.filter((a: any) => !isLikelyTattooHandle(a?.ig_handle));
        if (nonTattooHandles.length > 0) {
          console.log(`[generate] ${nonTattooHandles.length} artists with non-tattoo handles (kept in queue): ${
            nonTattooHandles.slice(0, 5).map((a: any) => a.ig_handle).join(', ')
          }`);
        }

        // 批量查询 SQLite ig_profile_data，与 Neon artists 数据合并用于打分
        const igProfileMap = new Map<string, any>();
        if (artists.length > 0) {
          const stmt = deepScanDb.prepare('SELECT * FROM ig_profile_data WHERE artist_id = ?');
          for (const a of artists) {
            const row = stmt.get(String(a.id)) as any;
            if (row) igProfileMap.set(String(a.id), row);
          }
        }
        const igScannedCount = igProfileMap.size;
        if (igScannedCount > 0) {
          console.log(`[lead-score] ${igScannedCount}/${artists.length} artists have IG deep data`);
        }

        if (!artists.length) {
          return res.status(404).json({ error: 'No eligible artists found for automation generation' });
        }

        const nowDate = new Date();
        const hour = nowDate.getHours();
        const inMainWindow = (hour >= 10 && hour < 13) || (hour >= 15 && hour < 19);
        const defaultLikeRatio = behaviorProfile === 'warmup' ? 0.18 : (behaviorProfile === 'active' ? 0.45 : 0.25);
        const calcLikeRatioByAccountAge = (ageDays: number) => {
          // Conservative warmup: ultra-low interaction for new accounts, gradual ramp
          if (ageDays <= 3) return Math.max(0.05, Math.min(0.08, 0.05 + ((ageDays - 1) / 2) * 0.03));
          if (ageDays <= 7) return Math.max(0.08, Math.min(0.12, 0.08 + ((ageDays - 4) / 3) * 0.04));
          if (ageDays <= 14) return Math.max(0.12, Math.min(0.20, 0.12 + ((ageDays - 8) / 6) * 0.08));
          if (ageDays <= 28) return Math.max(0.20, Math.min(0.30, 0.20 + ((ageDays - 15) / 13) * 0.10));
          if (ageDays <= 60) return Math.max(0.30, Math.min(0.40, 0.30 + ((ageDays - 29) / 31) * 0.10));
          return Math.max(0.40, Math.min(0.50, 0.40 + ((ageDays - 61) / 60) * 0.10));
        };
        const getLikePolicyByStage = (stage: 'new' | 'transition' | 'stable' | null) => {
          if (stage === 'new') {
            return {
              likePerVisitMin: 0,
              likePerVisitMax: 1,
              dailyLikeMin: 1,
              dailyLikeMax: 5
            };
          }
          if (stage === 'transition') {
            return {
              likePerVisitMin: 1,
              likePerVisitMax: 1,
              dailyLikeMin: 3,
              dailyLikeMax: 12
            };
          }
          return {
            likePerVisitMin: 1,
            likePerVisitMax: 2,
            dailyLikeMin: 8,
            dailyLikeMax: 25
          };
        };
        let likeRatioSource: 'manual' | 'account_age' | 'profile_default' = 'profile_default';
        let accountAgeDays: number | null = null;
        let accountStage: 'new' | 'transition' | 'stable' | null = null;
        let likeRatio = defaultLikeRatio;
        if (Number.isFinite(likeRatioRaw)) {
          likeRatio = Math.max(0, Math.min(1, likeRatioRaw));
          likeRatioSource = 'manual';
        } else if (accountId) {
          const row = deepScanDb
            .prepare(`SELECT first_seen_at FROM bot_account_usage WHERE account_id = ? LIMIT 1`)
            .get(accountId) as { first_seen_at: number } | undefined;
          if (row?.first_seen_at) {
            accountAgeDays = Math.max(1, Math.floor((Date.now() - Number(row.first_seen_at)) / (24 * 60 * 60 * 1000)) + 1);
            likeRatio = calcLikeRatioByAccountAge(accountAgeDays);
            likeRatioSource = 'account_age';
            if (accountAgeDays <= 7) accountStage = 'new';
            else if (accountAgeDays <= 28) accountStage = 'transition';
            else accountStage = 'stable';
          }
        }
        const calcBaseRunAt = () => {
          if (!batchByTimeWindow || inMainWindow) return Date.now();
          const next = new Date();
          if (hour < 10) {
            next.setHours(10, 0, 0, 0);
          } else if (hour < 15) {
            next.setHours(15, 0, 0, 0);
          } else {
            next.setDate(next.getDate() + 1);
            next.setHours(10, 0, 0, 0);
          }
          return next.getTime();
        };
        const baseRunAt = calcBaseRunAt();

        const normalizeCity = (v: any) => String(v || '').trim().toLowerCase() || 'unknown_city';
        const calcLeadScore = (a: any) => {
          // Signal weights (sum to 100)
          const W = {
            rating: 20,        // Google Maps rating (0-5 stars)
            reviews: 10,       // Google review count (log scale)
            website: 5,        // Has website
            ig_handle: 5,      // IG handle contains tattoo keywords
            followers: 15,     // IG followers (sweet spot 500-8000)
            engagement: 15,    // IG engagement rate (avg_likes/followers)
            frequency: 8,      // Post frequency (2-30 days ideal)
            verified: 10,      // IG verified badge
            posts: 5,          // Total posts count
            comments: 5,       // Avg comments per post
            private_penalty: -60, // Private account penalty
          };

          const igProfile = igProfileMap.get(String(a.id || ''));
          const hasIgDeep = !!igProfile;

          // ----- Maps signals (max 40) -----
          const rating = Number(a?.rating || 0);
          const reviews = Number(a?.reviews || 0);
          const hasWebsite = a?.website && a.website !== 'N/A' ? 1 : 0;
          const igHandle = String(a?.ig_handle || '').toLowerCase();
          const handleHasTattoo = /(tattoo|ink|needle|pierc|blackwork|fineline|irezumi)/.test(igHandle);

          const ratingScore = Math.round(Math.max(0, Math.min(W.rating, (rating / 5) * W.rating)));
          const reviewsScore = Math.round(Math.max(0, Math.min(W.reviews, (Math.log10(reviews + 1) / 3) * W.reviews)));
          const websiteScore = hasWebsite ? W.website : 0;
          const handleScore = handleHasTattoo ? W.ig_handle : 1;

          const mapsTotal = ratingScore + reviewsScore + websiteScore + handleScore; // max 40

          // ----- IG deep signals (max 60) -----
          if (!hasIgDeep) {
            // No IG data yet: maps contributes proportionally, cap at 50
            return Math.min(50, Math.round(mapsTotal * 1.25));
          }

          const followers = Number(igProfile.followers || 0);
          const posts = Number(igProfile.posts || 0);
          const avgLikes = Number(igProfile.avg_likes || 0);
          const avgComments = Number(igProfile.avg_comments || 0);
          const isVerified = Number(igProfile.is_verified || 0);
          const isPrivate = Number(igProfile.is_private || 0);
          const frequency = Number(igProfile.post_frequency_days || 999);
          const engagementRate = followers > 0 ? (avgLikes / followers) : 0;

          // Private account = heavy penalty
          if (isPrivate) return Math.max(5, Math.round(mapsTotal * 0.5 + W.private_penalty));

          // Followers score (0-15): sweet spot 500-8000
          let followerScore = 0;
          if (followers < 100) followerScore = 2;
          else if (followers < 500) followerScore = 6;
          else if (followers < 2000) followerScore = 12;
          else if (followers < 8000) followerScore = W.followers;
          else if (followers < 20000) followerScore = 10;
          else followerScore = 5;

          // Engagement rate score (0-15): healthy 2-10%
          let engagementScore = 0;
          if (engagementRate < 0.005) engagementScore = 2;
          else if (engagementRate < 0.02) engagementScore = 8;
          else if (engagementRate < 0.05) engagementScore = W.engagement;
          else if (engagementRate < 0.10) engagementScore = 12;
          else engagementScore = 7; // suspiciously high

          // Post frequency score (0-8): active but not spammy
          let freqScore = 0;
          if (frequency <= 0) freqScore = 4;
          else if (frequency < 2) freqScore = 3;
          else if (frequency <= 7) freqScore = W.frequency;
          else if (frequency <= 30) freqScore = 6;
          else if (frequency <= 90) freqScore = 3;
          else freqScore = 1;

          // Verified badge (0-10)
          const verifiedScore = isVerified ? W.verified : 0;

          // Posts count (0-5)
          let postsScore = 0;
          if (posts >= 50) postsScore = W.posts;
          else if (posts >= 20) postsScore = 3;
          else if (posts >= 9) postsScore = 2;
          else postsScore = 1;

          // Avg comments (0-5)
          let commentScore = 0;
          if (avgComments >= 10) commentScore = W.comments;
          else if (avgComments >= 5) commentScore = 3;
          else if (avgComments >= 2) commentScore = 1;

          const igTotal = followerScore + engagementScore + freqScore + verifiedScore + postsScore + commentScore; // max 60
          return Math.round(Math.min(100, mapsTotal + igTotal));
        };
        const getPriority = (score: number): 'high' | 'medium' | 'low' => {
          if (score >= 70) return 'high';
          if (score >= 50) return 'medium';
          return 'low';
        };
        const withScore = artists.map((a: any) => {
          const leadScore = calcLeadScore(a);
          const followPriority = getPriority(leadScore);
          return { ...a, leadScore, followPriority };
        });
        const artistsOrdered = (() => {
          if (dispatchMode === 'random') {
            // Weighted random: high score tends to appear earlier, but still mixed.
            return [...withScore].sort((x, y) => ((y.leadScore + Math.random() * 25) - (x.leadScore + Math.random() * 25)));
          }
          if (dispatchMode === 'city_round_robin') {
            const buckets = new Map<string, any[]>();
            for (const a of withScore) {
              const c = normalizeCity(a.city);
              if (!buckets.has(c)) buckets.set(c, []);
              buckets.get(c)!.push(a);
            }
            for (const [k, list] of buckets.entries()) {
              buckets.set(k, list.sort((x, y) => y.leadScore - x.leadScore));
            }
            const cities = Array.from(buckets.keys()).sort();
            const out: any[] = [];
            let moved = true;
            while (moved) {
              moved = false;
              for (const c of cities) {
                const q = buckets.get(c)!;
                if (q.length > 0) {
                  out.push(q.shift());
                  moved = true;
                }
              }
            }
            return out;
          }
          return [...withScore].sort((a, b) => b.leadScore - a.leadScore); // highest first
        })();

        const parseHandle = (v: string) => {
          const x = String(v || '').trim();
          if (!x) return '';
          if (x.includes('instagram.com/')) {
            const m = x.match(/instagram\.com\/([a-zA-Z0-9._-]+)/i);
            return m?.[1] || '';
          }
          return x.replace(/^@/, '').trim();
        };

        const insertStmt = deepScanDb.prepare(`
          INSERT INTO automation_tasks (
            id, payload, status, run_at, lease_until, leased_by, attempts, max_attempts, error_reason, created_at, updated_at
          ) VALUES (?, ?, 'pending', ?, NULL, NULL, 0, 3, NULL, ?, ?)
        `);

        const TASK_DEDUP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
        const existsStmt = deepScanDb.prepare(`
          SELECT id FROM automation_tasks
          WHERE json_extract(payload, '$.artistId') = ?
            AND created_at > ?
          LIMIT 1
        `);

        let created = 0;
        let skipped = 0;
        let high = 0;
        let medium = 0;
        let low = 0;
        for (const a of artistsOrdered) {
          const artistId = String(a.id || '').trim();
          const artistHandle = parseHandle(String(a.ig_handle || ''));
          if (!artistId || !artistHandle) {
            skipped += 1;
            continue;
          }
          const exists = existsStmt.get(artistId, now - TASK_DEDUP_WINDOW_MS) as { id: string } | undefined;
          if (exists?.id) {
            skipped += 1;
            continue;
          }
          const commandId = `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const priority = (a.followPriority || 'low') as 'high' | 'medium' | 'low';
          if (priority === 'high') high += 1;
          else if (priority === 'medium') medium += 1;
          else low += 1;
          let queueDelayMs = 0;
          if (priority === 'medium') queueDelayMs = (24 + Math.floor(Math.random() * 24)) * 60 * 60 * 1000; // +24~48h
          if (priority === 'low') queueDelayMs = (48 + Math.floor(Math.random() * 48)) * 60 * 60 * 1000; // +48~96h
          const runAt = baseRunAt + queueDelayMs + (created * (45 + Math.floor(Math.random() * 135)) * 1000); // 45-180s stagger
          const effectiveBehaviorProfile = (nightMode === 'light_browse_only' && !inMainWindow) ? 'warmup' : behaviorProfile;
          const forceBrowseOnlyAtNight = nightMode === 'light_browse_only' && !inMainWindow;
          const suggestedExecMode = forceBrowseOnlyAtNight
            ? 'browse_only'
            : (Math.random() < likeRatio ? 'browse_like' : 'browse_only');
          const payload = {
            id: commandId,
            artistId,
            artistHandle,
            behaviorProfile: effectiveBehaviorProfile,
            accountAgeDays,
            accountStage,
            language,
            accountType: 'shop/artist',
            source: 'auto_generate',
            dispatchMode,
            city: a.city || null,
            leadScore: a.leadScore || 0,
            followPriority: priority,
            suggestedExecMode,
            timestamp: new Date().toISOString(),
            protocol: {
              warmupPolicy: {
                likeRatio,
                ...getLikePolicyByStage(accountStage),
                likeGapSecMin: 40,
                likeGapSecMax: 120,
                revisitCooldownHoursMin: 36,
                revisitCooldownHoursMax: 72
              },
              steps: [
                { action: 'browse_feed', delay: 45 },
                { action: 'enter_profile', target: artistHandle, delay: 60 },
                { action: 'like', target: 'priority_posts', delay: 35 }
              ]
            }
          };
          insertStmt.run(commandId, JSON.stringify(payload), runAt, now, now);
          created += 1;
        }

        return res.json({
          ok: true,
          selected: artistsOrdered.length,
          created,
          skipped,
          priorityStats: { high, medium, low },
          autoDeletedNonTattoo: autoDeleteNonTattoo ? nonTattooRows.length : 0,
          filters: {
            state: state || 'ALL',
            noFilter,
            minRating,
            minReviews,
            limit,
            dispatchMode,
            batchByTimeWindow,
            nightMode,
            inMainWindow,
            autoDeleteNonTattoo,
            accountId: accountId || null,
            likeRatio,
            likeRatioSource,
            accountAgeDays,
            accountStage
          }
        });
      } catch (e: any) {
        return res.status(500).json({ error: 'Failed to generate automation tasks', details: e?.message || String(e) });
      }
    });

    // Generate automation tasks from content_competitors (supply_brand / supply_distributor)
    app.post('/api/automation/generate-from-competitors', async (req, res) => {
      try {
        const now = Date.now();
        const accountType = String(req.body?.accountType || 'supply_brand').trim();
        const limitRaw = Number(req.body?.limit);
        const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(50, Math.floor(limitRaw)) : 10;
        const handlesRaw: string[] | undefined = req.body?.handles;

        let competitors;
        if (Array.isArray(handlesRaw) && handlesRaw.length > 0) {
          // Manual mode: only selected handles
          const normalized = handlesRaw.map((h: string) => h.replace(/^@/, '').trim().toLowerCase());
          const placeholders = normalized.map(() => '?').join(',');
          competitors = deepScanDb
            .prepare(`SELECT handle, source, notes, account_type FROM content_competitors WHERE active = 1 AND handle IN (${placeholders})`)
            .all(...normalized) as Array<{ handle: string; source: string; notes: string | null; account_type: string }>;
        } else {
          if (!['supply_brand', 'supply_distributor'].includes(accountType)) {
            return res.status(400).json({ error: 'accountType must be supply_brand or supply_distributor' });
          }
          competitors = deepScanDb
            .prepare(`SELECT handle, source, notes, account_type FROM content_competitors WHERE active = 1 AND account_type = ? LIMIT ?`)
            .all(accountType, limit) as Array<{ handle: string; source: string; notes: string | null; account_type: string }>;
        }

        if (!competitors.length) {
          return res.json({ ok: true, created: 0, message: `No active competitors found` });
        }

        const dedupWindowMs = 7 * 24 * 60 * 60 * 1000;
        const existsStmt = deepScanDb.prepare(`
          SELECT id FROM automation_tasks
          WHERE json_extract(payload, '$.artistHandle') = ?
            AND created_at > ?
          LIMIT 1
        `);
        const insertStmt = deepScanDb.prepare(`
          INSERT INTO automation_tasks (id, payload, status, run_at, lease_until, leased_by, attempts, max_attempts, error_reason, created_at, updated_at)
          VALUES (?, ?, 'pending', ?, NULL, NULL, 0, 3, NULL, ?, ?)
        `);

        let created = 0, skipped = 0;
        for (let i = 0; i < competitors.length; i++) {
          const c = competitors[i];
          const handle = c.handle.toLowerCase();
          if (existsStmt.get(handle, now - dedupWindowMs)) { skipped++; continue; }

          const commandId = `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const staggerMs = i * (30 + Math.floor(Math.random() * 60)) * 1000;
          const runAt = now + staggerMs;

          const payload = {
            id: commandId,
            taskType: 'supply_analysis',
            artistId: `competitor_${handle}`,
            artistHandle: handle,
            accountType: c.account_type,
            behaviorProfile: 'warmup',
            source: 'competitor_auto',
            suggestedExecMode: 'browse_only',
            competitorSource: c.source,
            competitorNotes: c.notes,
            timestamp: new Date().toISOString(),
            protocol: {
              steps: [
                { action: 'browse_feed', delay: 45 },
                { action: 'enter_profile', target: handle, delay: 60 },
                { action: 'scrape_comments', target: 'recent_posts', delay: 35 }
              ]
            }
          };
          insertStmt.run(commandId, JSON.stringify(payload), runAt, now, now);
          created++;
        }

        return res.json({
          ok: true,
          accountType,
          total: competitors.length,
          created,
          skipped,
          competitors: competitors.map(c => c.handle)
        });
      } catch (e: any) {
        return res.status(500).json({ error: 'Failed to generate competitor tasks', details: e?.message || String(e) });
      }
    });

    app.get('/api/deep-scan/status/:taskId', (req, res) => {
      const task = getDeepTask(req.params.taskId);
      if (!task) return res.status(404).json({ error: 'Task not found' });
      return res.json(toTaskStatus(task));
    });

    app.get('/api/deep-scan/latest', (req, res) => {
      const task = getLatestDeepTask();
      if (!task) return res.status(404).json({ error: 'No deep scan task found' });
      return res.json(toTaskStatus(task));
    });

    app.post('/api/deep-scan/pause/:taskId', (req, res) => {
      const task = getDeepTask(req.params.taskId);
      if (!task) return res.status(404).json({ error: 'Task not found' });
      if (task.status === 'running') {
        task.status = 'paused';
        saveDeepTask(task);
      }
      return res.json(toTaskStatus(task));
    });

    app.post('/api/deep-scan/resume/:taskId', (req, res) => {
      const task = getDeepTask(req.params.taskId);
      if (!task) return res.status(404).json({ error: 'Task not found' });
      if (task.status !== 'completed') {
        task.status = 'running';
        saveDeepTask(task);
      }
      return res.json(toTaskStatus(task));
    });

    app.post('/api/deep-scan/retry-failed/:taskId', (req, res) => {
      const task = getDeepTask(req.params.taskId);
      if (!task) return res.status(404).json({ error: 'Task not found' });
      const reasonFilter = req.body?.reason ? normalizeFailedReason(req.body.reason) : null;
      const retryIds = reasonFilter
        ? task.failedIds.filter((id) => normalizeFailedReason(task.failedReasonById[id]) === reasonFilter)
        : [...task.failedIds];
      task.failedIds = task.failedIds.filter((id) => !retryIds.includes(id));
      retryIds.forEach((id) => {
        task.retryCountById[id] = 0;
        delete task.failedReasonById[id];
        if (!task.pendingIds.includes(id) && !task.completedIds.includes(id)) {
          task.pendingIds.push(id);
        }
      });
      if (task.status !== 'completed') task.status = 'running';
      saveDeepTask(task);
      return res.json({ retried: retryIds.length, reason: reasonFilter, ...toTaskStatus(task) });
    });

    app.get('/api/deep-scan/failed/:taskId', (req, res) => {
      const task = getDeepTask(req.params.taskId);
      if (!task) return res.status(404).json({ error: 'Task not found' });
      const items = task.failedIds.map((id) => ({
        id,
        reason: normalizeFailedReason(task.failedReasonById[id]),
        retryCount: task.retryCountById[id] || 0
      }));
      return res.json({ taskId: task.id, total: items.length, items });
    });

    app.post('/api/deep-scan/next/:taskId', (req, res) => {
      const task = getDeepTask(req.params.taskId);
      if (!task) return res.status(404).json({ error: 'Task not found' });
      if (task.status !== 'running') return res.json({ artistIds: [], ...toTaskStatus(task) });

      const requested = Number(req.body?.limit);
      const limit = Number.isFinite(requested) && requested > 0
        ? Math.min(200, Math.floor(requested))
        : task.batchSize;
      const now = Date.now();
      const leaseMs = 2 * 60 * 1000;
      const ids = task.pendingIds.splice(0, limit);
      ids.forEach((id) => {
        task.leasedUntilById[id] = now + leaseMs;
      });
      saveDeepTask(task);
      return res.json({ artistIds: ids, ...toTaskStatus(task) });
    });

    app.post('/api/deep-scan/report/:taskId', (req, res) => {
      const task = getDeepTask(req.params.taskId);
      if (!task) return res.status(404).json({ error: 'Task not found' });

      const successIds = Array.isArray(req.body?.successIds)
        ? req.body.successIds.map((id: any) => String(id)).filter(Boolean)
        : [];
      const failedItemsInput = Array.isArray(req.body?.failedItems)
        ? req.body.failedItems
            .map((item: any) => ({
              id: String(item?.id || '').trim(),
              reason: normalizeFailedReason(item?.reason)
            }))
            .filter((item: { id: string; reason: string }) => Boolean(item.id))
        : [];
      const fallbackFailedIds = Array.isArray(req.body?.failedIds)
        ? req.body.failedIds.map((id: any) => String(id)).filter(Boolean)
        : [];
      const failedItems = [
        ...failedItemsInput,
        ...fallbackFailedIds
          .filter((id: string) => !failedItemsInput.some((item: { id: string }) => item.id === id))
          .map((id: string) => ({ id, reason: 'unknown' }))
      ];

      successIds.forEach((id) => {
        delete task.leasedUntilById[id];
        if (!task.completedIds.includes(id)) task.completedIds.push(id);
        task.failedIds = task.failedIds.filter((x) => x !== id);
        delete task.failedReasonById[id];
      });

      failedItems.forEach(({ id, reason }) => {
        delete task.leasedUntilById[id];
        if (task.completedIds.includes(id)) return;
        const retries = (task.retryCountById[id] || 0) + 1;
        task.retryCountById[id] = retries;
        if (retries <= task.maxRetries) {
          if (!task.pendingIds.includes(id)) task.pendingIds.push(id);
        } else {
          if (!task.failedIds.includes(id)) task.failedIds.push(id);
          task.failedReasonById[id] = normalizeFailedReason(reason);
        }
      });

      saveDeepTask(task);
      const normalized = getDeepTask(task.id);
      return res.json(toTaskStatus(normalized || task));
    });

    // ========== Data Bot 接口 ==========

    // ========== Data Bot 辅助函数 ==========
    const computeAvgLikes = (sample: Array<{ likeCount: number }>) => {
      if (!sample?.length) return 0;
      return Math.round(sample.reduce((s, p) => s + (Number(p.likeCount) || 0), 0) / sample.length);
    };

    const computeAvgComments = (sample: Array<{ commentCount: number }>) => {
      if (!sample?.length) return 0;
      return Math.round(sample.reduce((s, p) => s + (Number(p.commentCount) || 0), 0) / sample.length);
    };

    const computePostFrequency = (sample: Array<{ ageDays: number }>) => {
      const ages = (sample || []).map((p) => p.ageDays).filter((d) => d < 999).sort((a, b) => a - b);
      if (ages.length < 2) return 0;
      let totalGap = 0;
      for (let i = 1; i < ages.length; i++) totalGap += ages[i] - ages[i - 1];
      return Math.round(totalGap / (ages.length - 1));
    };

    const getLastPostDate = (sample: Array<{ ageDays: number }>) => {
      const ages = (sample || []).map((p) => p.ageDays).filter((d) => d < 999);
      if (!ages.length) return '';
      const minDays = Math.min(...ages);
      const d = new Date(Date.now() - minDays * 24 * 60 * 60 * 1000);
      return d.toISOString().slice(0, 10);
    };

    // Data bot 拉取任务（带 IG handle）
    app.post('/api/data-bot/next', async (req, res) => {
      try {
        const botId = String(req.body?.botId || '').trim();
        if (!botId) return res.status(400).json({ error: 'botId required' });

        // 找第一个 running 的 deep scan 任务
        const runningRows = deepScanDb
          .prepare('SELECT id FROM deep_scan_tasks ORDER BY updated_at DESC LIMIT 10')
          .all() as Array<{ id: string }>;

        let items: Array<{ id: string; igHandle: string; shopName: string }> = [];
        let taskId = '';

        for (const row of runningRows) {
          const task = getDeepTask(row.id);
          if (!task || task.status !== 'running') continue;

          const limit = Math.min(Number(req.body?.batchSize) || 5, 10);
          const now = Date.now();
          const leaseMs = 5 * 60 * 1000;
          const ids = task.pendingIds.splice(0, limit);

          if (ids.length === 0) continue;

          // 查 Neon 获取 IG handles
          try {
            const artists = await sql.query(
              'SELECT id, shop_name, ig_handle FROM artists WHERE id = ANY($1::text[])',
              [ids]
            );
            const byId = new Map<string, { shopName: string; igHandle: string }>();
            artists.forEach((a: any) => {
              const handle = (a.ig_handle || '').replace(/^@/, '').replace(/https?:\/\/instagram\.com\//, '').replace(/\/$/, '');
              if (handle) byId.set(String(a.id), { shopName: String(a.shop_name || ''), igHandle: handle });
            });

            for (const id of ids) {
              const info = byId.get(id);
              if (info?.igHandle) {
                items.push({ id, igHandle: info.igHandle, shopName: info.shopName });
                task.leasedUntilById[id] = now + leaseMs;
              } else {
                // 没 IG handle 的退回，后面不再重试
                if (!task.completedIds.includes(id)) task.completedIds.push(id);
              }
            }
          } catch {}

          taskId = task.id;
          saveDeepTask(task);
          if (items.length > 0) break; // 拿到了就停
          // 否则继续查下一个 task
        }

        return res.json({ taskId, items });
      } catch (e: any) {
        return res.status(500).json({ error: e?.message || 'data-bot next failed' });
      }
    });

    // Data bot 回传 IG 深度数据
    app.post('/api/data-bot/report/:taskId', (req, res) => {
      const task = getDeepTask(req.params.taskId);
      if (!task) return res.status(404).json({ error: 'Task not found' });

      const profiles = Array.isArray(req.body?.profiles) ? req.body.profiles : [];
      const now = Date.now();

      for (const p of profiles) {
        const id = String(p.id || '').trim();
        if (!id) continue;

        // 标记 deep scan task 完成
        delete task.leasedUntilById[id];
        if (!task.completedIds.includes(id)) task.completedIds.push(id);
        task.failedIds = task.failedIds.filter((x) => x !== id);

        // 写入 SQLite ig_profile_data
        try {
          deepScanDb.prepare(`
            INSERT INTO ig_profile_data (artist_id, followers, following, posts, bio, category,
              is_verified, is_private, avg_likes, avg_comments, post_frequency_days,
              last_post_date, posts_sample, scanned_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(artist_id) DO UPDATE SET
              followers=excluded.followers, following=excluded.following,
              posts=excluded.posts, bio=excluded.bio, category=excluded.category,
              is_verified=excluded.is_verified, is_private=excluded.is_private,
              avg_likes=excluded.avg_likes, avg_comments=excluded.avg_comments,
              post_frequency_days=excluded.post_frequency_days,
              last_post_date=excluded.last_post_date,
              posts_sample=excluded.posts_sample, scanned_at=excluded.scanned_at
          `).run(
            id,
            Number(p.followers) || 0,
            Number(p.following) || 0,
            Number(p.posts) || 0,
            String(p.bio || '').slice(0, 1000),
            String(p.category || '').slice(0, 200),
            p.isVerified ? 1 : 0,
            p.isPrivate ? 1 : 0,
            computeAvgLikes(p.postsSample),
            computeAvgComments(p.postsSample),
            computePostFrequency(p.postsSample),
            getLastPostDate(p.postsSample),
            JSON.stringify(p.postsSample || []),
            now
          );
        } catch (e: any) {
          console.error(`data-bot report write error: ${e.message}`);
        }

        // 同时更新 Neon artists 表的核心字段
        try {
          sql.unsafe(`
            UPDATE artists SET
              ig_followers = ${Number(p.followers) || 0},
              ig_posts = ${Number(p.posts) || 0},
              ig_scanned_at = NOW()
            WHERE id = '${id.replace(/'/g, "''")}'
          `).catch(() => {});
        } catch {}
      }

      // 处理失败的
      const failedItems = Array.isArray(req.body?.failedItems) ? req.body.failedItems : [];
      for (const fi of failedItems) {
        const id = String(fi?.id || '').trim();
        if (!id) continue;
        delete task.leasedUntilById[id];
        const retries = (task.retryCountById[id] || 0) + 1;
        task.retryCountById[id] = retries;
        if (retries <= task.maxRetries) {
          if (!task.pendingIds.includes(id)) task.pendingIds.push(id);
        } else {
          if (!task.failedIds.includes(id)) task.failedIds.push(id);
          task.failedReasonById[id] = normalizeFailedReason(fi.reason);
        }
      }

      saveDeepTask(task);
      return res.json({ ok: true, processed: profiles.length + failedItems.length });
    });

    // 获取 artist 的 IG handle（data-bot 查询用）
    app.get('/api/artists/:id/social', async (req, res) => {
      try {
        const id = String(req.params.id).trim();
        const rows = await sql.query(
          'SELECT id, shop_name, ig_handle, facebook, tiktok, website FROM artists WHERE id = $1',
          [id]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
        const a = rows[0] as any;
        return res.json({
          id: String(a.id),
          shopName: String(a.shop_name || ''),
          igHandle: String(a.ig_handle || ''),
          facebook: String(a.facebook || ''),
          tiktok: String(a.tiktok || ''),
          website: String(a.website || ''),
        });
      } catch (e: any) {
        return res.status(500).json({ error: e?.message || 'fetch failed' });
      }
    });

    // 查询 IG profile 数据（网页端用）
    app.get('/api/ig-profile/:artistId', (req, res) => {
      const row = deepScanDb
        .prepare('SELECT * FROM ig_profile_data WHERE artist_id = ?')
        .get(req.params.artistId) as any;
      if (!row) return res.status(404).json({ error: 'Not found' });
      try { row.posts_sample = JSON.parse(row.posts_sample || '[]'); } catch { row.posts_sample = []; }
      return res.json(row);
    });

    app.post('/api/bot/register', (req, res) => {
      if (!requireBotAuth(req, res)) return;
      const payload = toBotPayload(req.body || {});
      if (!payload.botId) {
        return res.status(400).json({ error: 'botId is required' });
      }
      upsertBot(payload);
      const state = getBotOnlineState(payload.botId);
      return res.json({
        ok: true,
        botId: payload.botId,
        online: state.online,
        staleMs: state.staleMs
      });
    });

    app.post('/api/bot/heartbeat', (req, res) => {
      if (!requireBotAuth(req, res)) return;
      const payload = toBotPayload(req.body || {});
      if (!payload.botId) {
        return res.status(400).json({ error: 'botId is required' });
      }
      upsertBot(payload);
      return res.json({ ok: true, botId: payload.botId, ts: Date.now() });
    });

    app.post('/api/bot/pause/:botId', (req, res) => {
      if (!requireBotAuth(req, res)) return;
      const botId = String(req.params?.botId || '').trim();
      if (!botId) return res.status(400).json({ error: 'botId is required' });
      const row = getBotRow(botId);
      if (!row) return res.status(404).json({ error: 'Bot not registered' });
      const now = Date.now();
      deepScanDb
        .prepare(`
          UPDATE bot_instances
          SET status = 'paused',
              updated_at = ?
          WHERE bot_id = ?
        `)
        .run(now, botId);
      return res.json({ ok: true, botId, status: 'paused', updatedAt: now });
    });

    app.post('/api/bot/resume/:botId', (req, res) => {
      if (!requireBotAuth(req, res)) return;
      const botId = String(req.params?.botId || '').trim();
      if (!botId) return res.status(400).json({ error: 'botId is required' });
      const row = getBotRow(botId);
      if (!row) return res.status(404).json({ error: 'Bot not registered' });
      const now = Date.now();
      deepScanDb
        .prepare(`
          UPDATE bot_instances
          SET status = 'online',
              updated_at = ?
          WHERE bot_id = ?
        `)
        .run(now, botId);
      return res.json({ ok: true, botId, status: 'online', updatedAt: now });
    });

    app.post('/api/bot/pause-all', (req, res) => {
      if (!requireBotAuth(req, res)) return;
      const now = Date.now();
      const paused = pauseAllBotsInternal();
      return res.json({ ok: true, paused, updatedAt: now });
    });

    app.post('/api/bot/resume-all', (req, res) => {
      if (!requireBotAuth(req, res)) return;
      const now = Date.now();
      const rows = deepScanDb
        .prepare(`SELECT bot_id FROM bot_instances`)
        .all() as Array<{ bot_id: string }>;
      const resumed = resumeBotsInternal(rows.map((r) => String(r.bot_id || '')).filter(Boolean));
      return res.json({ ok: true, resumed, updatedAt: now });
    });

    app.post('/api/bot/observe', async (req, res) => {
      if (!requireBotAuth(req, res)) return;
      const botId = String(req.body?.botId || '').trim();
      if (!botId) return res.status(400).json({ error: 'botId is required' });

      const commandId = req.body?.commandId ? String(req.body.commandId) : null;
      const artistId = req.body?.artistId ? String(req.body.artistId) : null;
      const artistHandle = req.body?.artistHandle ? String(req.body.artistHandle).replace(/^@/, '').trim() : null;
      const mode = req.body?.mode ? String(req.body.mode) : null;
      const summary = req.body?.summary && typeof req.body.summary === 'object' ? req.body.summary : {};
      const profileFacts = req.body?.profileFacts && typeof req.body.profileFacts === 'object' ? req.body.profileFacts : {};
      const profileEmail = String(
        profileFacts?.email ||
        (Array.isArray(profileFacts?.emails) ? profileFacts.emails[0] : '') ||
        ''
      ).trim().toLowerCase();
      const nonTattooSuspect = profileFacts?.nonTattooSuspect === true;
      const enforceDeleteNonTattoo = req.body?.enforceDeleteNonTattoo === true; // default false
      const now = Date.now();

      deepScanDb
        .prepare(`
          INSERT INTO bot_observations (
            bot_id, command_id, artist_id, artist_handle, mode, summary_json, profile_facts_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          botId,
          commandId,
          artistId,
          artistHandle,
          mode,
          JSON.stringify(summary || {}),
          JSON.stringify(profileFacts || {}),
          now
        );

      // Store relationship graph edges
      const relationships = req.body?.relationships;
      if (relationships && typeof relationships.sourceIgUserId === 'string') {
        const insertRel = deepScanDb.prepare(`
          INSERT INTO ig_relationships (
            source_handle, source_ig_user_id, target_username, target_full_name,
            target_profile_pic_url, target_is_private, target_is_verified,
            relationship_type, observed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(source_ig_user_id, target_username, relationship_type) DO UPDATE SET
            target_full_name = excluded.target_full_name,
            target_profile_pic_url = excluded.target_profile_pic_url,
            target_is_private = excluded.target_is_private,
            target_is_verified = excluded.target_is_verified,
            observed_at = excluded.observed_at
        `);
        const { sourceHandle, sourceIgUserId, followers, following } = relationships;
        if (Array.isArray(followers)) {
          for (const f of followers) {
            try {
              insertRel.run(
                sourceHandle, sourceIgUserId,
                String(f.username || ''), String(f.fullName || '').slice(0, 200),
                String(f.profilePicUrl || ''), f.isPrivate ? 1 : 0, f.isVerified ? 1 : 0,
                'follower', now
              );
            } catch {}
          }
        }
        if (Array.isArray(following)) {
          for (const f of following) {
            try {
              insertRel.run(
                sourceHandle, sourceIgUserId,
                String(f.username || ''), String(f.fullName || '').slice(0, 200),
                String(f.profilePicUrl || ''), f.isPrivate ? 1 : 0, f.isVerified ? 1 : 0,
                'following', now
              );
            } catch {}
          }
        }
      }

      // Track follow actions for self-learning feedback
      const followSummary = req.body?.followSummary;
      const igUserId = String(profileFacts?.igUserId || '');
      if (followSummary && followSummary.followed > 0 && artistHandle && igUserId) {
        try {
          deepScanDb.prepare(`
            INSERT INTO ig_follow_actions (bot_id, target_handle, target_ig_user_id, followed_at, created_at)
            VALUES (?, ?, ?, ?, ?)
          `).run(botId, artistHandle, igUserId, now, now);
        } catch {}
      }

      // Best-effort writeback to artists table for downstream use.
      try {
        if (nonTattooSuspect && enforceDeleteNonTattoo) {
          if (artistId) {
            await sql`DELETE FROM artists WHERE id = ${artistId}`;
            deepScanDb.prepare(`
              DELETE FROM automation_tasks
              WHERE json_extract(payload, '$.artistId') = ?
            `).run(artistId);
          } else if (artistHandle) {
            const matched = await sql`
              SELECT id FROM artists WHERE ig_handle ILIKE ${'%' + artistHandle + '%'} LIMIT 20
            `;
            const ids = (matched as any[]).map((x) => String(x.id || '')).filter(Boolean);
            if (ids.length > 0) {
              await sql`DELETE FROM artists WHERE id = ANY(${ids}::text[])`;
              const delTaskStmt = deepScanDb.prepare(`
                DELETE FROM automation_tasks
                WHERE json_extract(payload, '$.artistId') = ?
              `);
              ids.forEach((id) => delTaskStmt.run(id));
            }
          }
          return res.json({ ok: true, botId, createdAt: now, nonTattooDeleted: true, nonTattooSuspect: true });
        }

        if (artistId) {
          await sql`
            UPDATE artists
            SET last_updated = NOW()
              , email = CASE
                  WHEN ${profileEmail} <> '' AND (email IS NULL OR email = '' OR email = 'N/A') THEN ${profileEmail}
                  ELSE email
                END
            WHERE id = ${artistId}
          `;
        } else if (artistHandle) {
          await sql`
            UPDATE artists
            SET last_updated = NOW()
              , email = CASE
                  WHEN ${profileEmail} <> '' AND (email IS NULL OR email = '' OR email = 'N/A') THEN ${profileEmail}
                  ELSE email
                END
            WHERE ig_handle ILIKE ${'%' + artistHandle + '%'}
          `;
        }
      } catch (e) {
        console.warn('[bot/observe] artists writeback skipped:', e);
      }

      // Extract negative/scraped comments into competitor_reviews
      const scrapedComments: any[] = Array.isArray(profileFacts?.scrapedComments) ? profileFacts.scrapedComments : [];
      const commentSentiment: any[] = Array.isArray(profileFacts?.commentSentiment) ? profileFacts.commentSentiment : [];
      if (scrapedComments.length > 0 && commentSentiment.length > 0 && artistHandle) {
        const insertReview = deepScanDb.prepare(`
          INSERT INTO competitor_reviews (product_name, source, source_url, reviewer_name, rating, review_text, sentiment, key_themes, reviewed_at, scraped_at)
          VALUES (?, 'instagram', ?, ?, NULL, ?, ?, ?, NULL, ?)
        `);
        for (const s of commentSentiment) {
          if (s.sentiment === 'negative' || s.sentiment === 'positive') {
            const idx = Number(s.index);
            const comment = scrapedComments[idx];
            if (!comment) continue;
            try {
              insertReview.run(
                artistHandle,
                `https://instagram.com/p/task_${commandId || 'supply'}`,
                comment.username,
                comment.text,
                s.sentiment,
                JSON.stringify(s.themes || []),
                now
              );
            } catch {}
          }
        }
        // Create alerts for negative reviews
        const negatives = commentSentiment.filter((s: any) => s.sentiment === 'negative');
        if (negatives.length > 0) {
          const insertAlert = deepScanDb.prepare(`
            INSERT INTO competitor_alerts (brand_name, alert_type, title, details, source_url, created_at)
            VALUES (?, 'negative_comment', ?, ?, ?, ?)
          `);
          for (const n of negatives) {
            const idx = Number(n.index);
            const comment = scrapedComments[idx];
            if (!comment) continue;
            insertAlert.run(
              artistHandle,
              `Negative comment by @${comment.username}`,
              `${n.summary || comment.text.slice(0, 300)} | Themes: ${(n.themes || []).join(', ')}`,
              `https://instagram.com/p/task_${commandId || 'supply'}`,
              now
            );
          }
        }
      }

      // =====================================================================
      // Enhanced: Lead scoring + stage progression + follow-up decisions
      // =====================================================================
      if (artistHandle) {
        try {
          const likeSummary = profileFacts?.likeSummary || {};
          const followSummary = profileFacts?.followSummary || {};
          const commentSummary = profileFacts?.commentSummary || {};
          const touches = Number(profileFacts?.touches || 0);
          const leadScore = Number(profileFacts?.leadScore || 0);
          const followers = Number(profileFacts?.followers || 0);
          const following = Number(profileFacts?.following || 0);
          const postCount = Number(profileFacts?.postCount || 0);
          const categoryLabel = String(profileFacts?.categoryLabel || '');
          const hasWebsite = String(profileFacts?.externalUrl || '').length > 0;
          const hasEmail = String(profileFacts?.email || '').length > 0;

          // Check if this handle recently followed back (from ig_follow_actions)
          const followBackRecord = deepScanDb.prepare(`
            SELECT follow_back_detected FROM ig_follow_actions
            WHERE target_handle = ? AND follow_back_detected = 1
            ORDER BY follow_back_at DESC LIMIT 1
          `).get(artistHandle) as { follow_back_detected: number } | undefined;
          const followBack = followBackRecord?.follow_back_detected === 1;

          // Calculate interaction quality score based on actual bot actions
          const likesGiven = Number(likeSummary?.liked || 0);
          const commentsGiven = Number(commentSummary?.posted || 0);
          const followsGiven = Number(followSummary?.followed || 0);
          const interactionScore = Math.min(100, Math.round(
            (likesGiven > 0 ? 20 : 0) +
            (commentsGiven > 0 ? 30 : 0) +
            (followsGiven > 0 ? 15 : 0) +
            (followBack ? 35 : 0)
          ));

          // Composite lead score: merge initial score + interaction feedback
          const compositeScore = Math.min(100, Math.round(
            (leadScore * 0.6) + (interactionScore * 0.4)
          ));

          // Determine CRM stage based on composite signals
          const currentStage = String((profileFacts as any)?.currentStage || '').trim().toLowerCase();
          let newStage = currentStage || 'lead';
          if (followBack) {
            newStage = 'engaged';        // follow-back = confirmed interest
          } else if (compositeScore >= 80 && touches >= 3) {
            newStage = 'engaged';        // high score + multiple touches
          } else if (compositeScore >= 60 && touches >= 2) {
            newStage = 'warm';           // warm lead
          } else if (compositeScore < 30 && touches >= 2) {
            newStage = 'cold';           // cold lead, deprioritize
          }

          // Update artists table in Neon (best-effort)
          if (profileFacts?.artistId) {
            await sql`
              UPDATE artists
              SET stage = ${newStage}
                , heat_score = ${compositeScore}
                , last_updated = NOW()
              WHERE id = ${profileFacts.artistId}
            `.catch(() => {});
          }

          // ================================================================
          // Decision: Create follow-up tasks
          // ================================================================
          const insertMarketingTask = deepScanDb.prepare(`
            INSERT INTO marketing_tasks (target_handle, target_name, artist_id, bot_id, category, direction, script_content, lead_score, touch_count, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          const insertTask = deepScanDb.prepare(`
            INSERT INTO automation_tasks (id, payload, status, run_at, lease_until, leased_by, attempts, max_attempts, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          if (followBack) {
            // --- FOLLOW-BACK: Create DM marketing task ---
            let category = 'industry_talk';
            let direction = 'tech_discussion';
            if (categoryLabel.toLowerCase().includes('tattoo') || categoryLabel.toLowerCase().includes('shop')) {
              if (followers >= 5000) { category = 'collaboration'; direction = 'sample_review'; }
              else { category = 'product_intro'; direction = 'website_visit'; }
            }
            if (hasEmail || hasWebsite) { category = 'product_intro'; direction = 'website_visit'; }

            let scriptContent = '';
            try {
              const scripts = deepScanDb.prepare(`
                SELECT content FROM marketing_scripts
                WHERE category = ? AND active = 1
                ORDER BY success_rate DESC, usage_count ASC
                LIMIT 1
              `).all(category) as Array<{ content: string }>;
              if (scripts.length > 0) {
                scriptContent = scripts[0].content;
              } else {
                scriptContent = JSON.stringify({
                  category, direction, generated: true, tone: 'professional_friendly',
                  template: `Hey @${artistHandle}! We loved your work and think our tattoo supplies would be a great fit for your shop.`,
                });
              }
            } catch {}

            deepScanDb.prepare(`
              INSERT INTO marketing_tasks (target_handle, target_name, artist_id, bot_id, category, direction, script_content, lead_score, touch_count, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              artistHandle,
              String(profileFacts?.fullName || profileFacts?.title || '').slice(0, 200),
              profileFacts?.artistId || null, botId,
              category, direction, scriptContent,
              compositeScore, touches, now, now
            );
          }
          // Non-followBack: no automated task creation.
          // Natural re-visits happen when generate-from-artists is triggered again.
        } catch (e) {
          console.warn('[bot/observe] followup decision skipped:', e);
        }
      }

      // Feed content signals to Content Pipeline when high-value content found
      if (artistHandle) {
        try {
          const caption = String(profileFacts?.sampleCaption || '');
          const styleTags = Array.isArray(profileFacts?.styleKeywords) ? profileFacts.styleKeywords : [];
          const imageHits = Array.isArray(profileFacts?.imageAltHints) ? profileFacts.imageAltHints : [];
          const highSignal = styleTags.length >= 2 || imageHits.length >= 3;
          if (highSignal && caption) {
            deepScanDb.prepare(`
              INSERT INTO content_samples (handle, source_type, caption, style_tags_json, topic_tag, observed_at, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
              artistHandle, 'outreach_observation',
              caption.slice(0, 1000),
              JSON.stringify([...new Set([...styleTags, ...imageHits])]),
              styleTags[0] || 'tattoo',
              now, now
            );
          }
        } catch {}
      }

      return res.json({ ok: true, botId, createdAt: now, nonTattooSuspect, nonTattooDeleted: false });
    });

    app.get('/api/bot/observations', (req, res) => {
      const limitRaw = Number(req.query?.limit);
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(500, Math.floor(limitRaw)) : 100;
      const rows = deepScanDb
        .prepare(`
          SELECT id, bot_id, command_id, artist_id, artist_handle, mode, summary_json, profile_facts_json, created_at
          FROM bot_observations
          ORDER BY created_at DESC
          LIMIT ?
        `)
        .all(limit) as Array<{
          id: number;
          bot_id: string;
          command_id: string | null;
          artist_id: string | null;
          artist_handle: string | null;
          mode: string | null;
          summary_json: string;
          profile_facts_json: string | null;
          created_at: number;
        }>;

      const observations = rows.map((r) => {
        let summary: any = {};
        let profileFacts: any = {};
        try { summary = r.summary_json ? JSON.parse(r.summary_json) : {}; } catch {}
        try { profileFacts = r.profile_facts_json ? JSON.parse(r.profile_facts_json) : {}; } catch {}
        return {
          id: r.id,
          botId: r.bot_id,
          commandId: r.command_id,
          artistId: r.artist_id,
          artistHandle: r.artist_handle,
          mode: r.mode,
          summary,
          profileFacts,
          createdAt: new Date(Number(r.created_at)).toISOString()
        };
      });
      return res.json({ total: observations.length, observations });
    });

    // --- IG Relationship Graph APIs ---

    app.get('/api/ig-relationships/:handle', (req, res) => {
      const handle = String(req.params.handle || '').replace(/^@/, '').trim();
      if (!handle) return res.status(400).json({ error: 'handle is required' });

      const followers = deepScanDb.prepare(`
        SELECT target_username, target_full_name, target_profile_pic_url,
               target_is_private, target_is_verified, observed_at
        FROM ig_relationships
        WHERE source_handle = ? AND relationship_type = 'follower'
        ORDER BY observed_at DESC
        LIMIT 200
      `).all(handle);

      const following = deepScanDb.prepare(`
        SELECT target_username, target_full_name, target_profile_pic_url,
               target_is_private, target_is_verified, observed_at
        FROM ig_relationships
        WHERE source_handle = ? AND relationship_type = 'following'
        ORDER BY observed_at DESC
        LIMIT 200
      `).all(handle);

      return res.json({ handle, followers, following });
    });

    app.get('/api/ig-shared-followers', (req, res) => {
      const a = String(req.query.a || '').replace(/^@/, '').trim();
      const b = String(req.query.b || '').replace(/^@/, '').trim();
      if (!a || !b) return res.status(400).json({ error: 'Both a and b query params required' });

      const shared = deepScanDb.prepare(`
        SELECT a.target_username, a.target_full_name
        FROM ig_relationships a
        JOIN ig_relationships b ON a.target_username = b.target_username
        WHERE a.source_handle = ? AND a.relationship_type = 'follower'
          AND b.source_handle = ? AND b.relationship_type = 'follower'
        LIMIT 200
      `).all(a, b);

      return res.json({ handleA: a, handleB: b, sharedFollowers: shared });
    });

    app.get('/api/ig-graph', (req, res) => {
      // Top-connected shops: shops with the most mutual follows + shared followers
      const city = String(req.query.city || '').trim();
      const rows = deepScanDb.prepare(`
        SELECT source_handle, relationship_type, COUNT(*) as edge_count
        FROM ig_relationships
        GROUP BY source_handle, relationship_type
        ORDER BY edge_count DESC
        LIMIT 100
      `).all();

      return res.json({ city: city || 'all', topConnected: rows });
    });

    // --- Bot Self-Learning APIs ---

    app.get('/api/bot/learning-stats', (req, res) => {
      const botId = String(req.query.botId || '').trim();

      // Follow-back stats
      const followActions = deepScanDb.prepare(`
        SELECT target_handle, target_ig_user_id, followed_at, follow_back_detected, follow_back_at
        FROM ig_follow_actions
        WHERE (bot_id = ? OR ? = '')
        ORDER BY followed_at DESC
        LIMIT 200
      `).all(botId, botId) as Array<{
        target_handle: string;
        target_ig_user_id: string;
        followed_at: number;
        follow_back_detected: number;
        follow_back_at: number | null;
      }>;

      const totalFollows = followActions.length;
      const followBacks = followActions.filter(f => f.follow_back_detected === 1).length;
      const followBackRate = totalFollows > 0 ? (followBacks / totalFollows) : 0;

      // Recent follows (last 7 days)
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const recentFollows = followActions.filter(f => f.followed_at > sevenDaysAgo);

      return res.json({
        botId: botId || 'all',
        totalFollows,
        followBacks,
        followBackRate,
        recentFollows7d: recentFollows.length,
        recentFollowActions: followActions.slice(0, 50)
      });
    });

    app.post('/api/bot/follow-back-report', (req, res) => {
      const targetHandle = String(req.body?.targetHandle || '').replace(/^@/, '').trim();
      const didFollowBack = req.body?.didFollowBack === true;
      if (!targetHandle) return res.status(400).json({ error: 'targetHandle required' });

      try {
        deepScanDb.prepare(`
          UPDATE ig_follow_actions
          SET follow_back_detected = ?, follow_back_at = ?
          WHERE target_handle = ? AND follow_back_detected = 0
        `).run(didFollowBack ? 1 : 0, didFollowBack ? Date.now() : null, targetHandle);
        return res.json({ ok: true, targetHandle, didFollowBack });
      } catch (e: any) {
        return res.status(500).json({ error: e?.message || 'update failed' });
      }
    });

    // ============ Competitive Intelligence API ============

    // GET /api/competitor/products — list tracked competitor products
    app.get('/api/competitor/products', (req, res) => {
      try {
        const status = String(req.query.status || 'active');
        const rows = deepScanDb
          .prepare('SELECT * FROM competitor_products WHERE status = ? ORDER BY last_seen_at DESC')
          .all(status);
        return res.json({ rows, total: rows.length });
      } catch (e: any) {
        return res.status(500).json({ error: e?.message || 'query failed' });
      }
    });

    // GET /api/competitor/reviews — list competitor reviews, supports sentiment filter
    app.get('/api/competitor/reviews', (req, res) => {
      try {
        const sentiment = String(req.query.sentiment || '');
        const limit = Math.min(Number(req.query.limit) || 50, 200);
        let rows;
        if (sentiment) {
          rows = deepScanDb
            .prepare('SELECT * FROM competitor_reviews WHERE sentiment = ? ORDER BY scraped_at DESC LIMIT ?')
            .all(sentiment, limit);
        } else {
          rows = deepScanDb
            .prepare('SELECT * FROM competitor_reviews ORDER BY scraped_at DESC LIMIT ?')
            .all(limit);
        }
        return res.json({ rows, total: rows.length, sentiment });
      } catch (e: any) {
        return res.status(500).json({ error: e?.message || 'query failed' });
      }
    });

    // GET /api/competitor/mentions — list brand mentions
    app.get('/api/competitor/mentions', (req, res) => {
      try {
        const platform = String(req.query.platform || '');
        const limit = Math.min(Number(req.query.limit) || 50, 200);
        let rows;
        if (platform) {
          rows = deepScanDb
            .prepare('SELECT * FROM brand_mentions WHERE platform = ? ORDER BY scraped_at DESC LIMIT ?')
            .all(platform, limit);
        } else {
          rows = deepScanDb
            .prepare('SELECT * FROM brand_mentions ORDER BY scraped_at DESC LIMIT ?')
            .all(limit);
        }
        return res.json({ rows, total: rows.length, platform: platform || 'all' });
      } catch (e: any) {
        return res.status(500).json({ error: e?.message || 'query failed' });
      }
    });

    // GET /api/competitor/alerts — get unread alerts
    // POST /api/competitor/alerts — mark alert as read
    app.get('/api/competitor/alerts', (req, res) => {
      try {
        const unreadOnly = req.query.unread === '1';
        const rows = unreadOnly
          ? deepScanDb.prepare('SELECT * FROM competitor_alerts WHERE is_read = 0 ORDER BY created_at DESC').all()
          : deepScanDb.prepare('SELECT * FROM competitor_alerts ORDER BY created_at DESC LIMIT 50').all();
        return res.json({ rows, total: rows.length });
      } catch (e: any) {
        return res.status(500).json({ error: e?.message || 'query failed' });
      }
    });

    app.post('/api/competitor/alerts', (req, res) => {
      try {
        const alertId = Number(req.body?.id);
        const isRead = req.body?.is_read === true || req.body?.is_read === 1;
        if (!alertId) return res.status(400).json({ error: 'id required' });
        deepScanDb.prepare('UPDATE competitor_alerts SET is_read = ? WHERE id = ?').run(isRead ? 1 : 0, alertId);
        return res.json({ ok: true, id: alertId, is_read: isRead });
      } catch (e: any) {
        return res.status(500).json({ error: e?.message || 'update failed' });
      }
    });

    // GET /api/competitor/stats — overall competitive intelligence stats
    app.get('/api/competitor/stats', (req, res) => {
      try {
        const products = deepScanDb.prepare('SELECT COUNT(*) as c FROM competitor_products WHERE status = ?').get('active') as any;
        const productsTotal = deepScanDb.prepare('SELECT COUNT(*) as c FROM competitor_products').get() as any;
        const reviews = deepScanDb.prepare('SELECT COUNT(*) as c FROM competitor_reviews').get() as any;
        const negReviews = deepScanDb.prepare("SELECT COUNT(*) as c FROM competitor_reviews WHERE sentiment IN ('negative','mixed')").get() as any;
        const mentions = deepScanDb.prepare('SELECT COUNT(*) as c FROM brand_mentions').get() as any;
        const unreadAlerts = deepScanDb.prepare('SELECT COUNT(*) as c FROM competitor_alerts WHERE is_read = 0').get() as any;
        const recentMentions = deepScanDb.prepare(
          'SELECT * FROM brand_mentions ORDER BY scraped_at DESC LIMIT 5'
        ).all();

        return res.json({
          activeProducts: products?.c || 0,
          totalProducts: productsTotal?.c || 0,
          totalReviews: reviews?.c || 0,
          negativeReviews: negReviews?.c || 0,
          totalMentions: mentions?.c || 0,
          unreadAlerts: unreadAlerts?.c || 0,
          recentMentions: recentMentions,
        });
      } catch (e: any) {
        return res.status(500).json({ error: e?.message || 'query failed' });
      }
    });

    // ========== AI Review Queue — human verification of AI classifications ==========

    // GET /api/intel/review/queue — list items pending human review
    app.get('/api/intel/review/queue', (req, res) => {
      try {
        const limit = Math.min(50, Number(req.query?.limit) || 20);
        const filter = String(req.query?.filter || 'pending'); // pending | all | approved | corrected
        let items: any[];
        if (filter === 'all') {
          items = deepScanDb.prepare('SELECT * FROM review_queue ORDER BY created_at DESC LIMIT ?').all(limit);
        } else if (filter === 'pending') {
          items = deepScanDb.prepare("SELECT * FROM review_queue WHERE review_status = 'pending' ORDER BY confidence ASC, created_at DESC LIMIT ?").all(limit);
        } else {
          items = deepScanDb.prepare('SELECT * FROM review_queue WHERE review_status = ? ORDER BY reviewed_at DESC LIMIT ?').all(filter, limit);
        }
        const stats = deepScanDb.prepare("SELECT review_status, confidence, COUNT(*) as c FROM review_queue GROUP BY review_status, confidence").all();
        return res.json({ items, stats });
      } catch (e: any) {
        return res.status(500).json({ error: e?.message || 'query failed' });
      }
    });

    // POST /api/intel/review/:id — approve, correct, or reject an AI classification
    app.post('/api/intel/review/:id', (req, res) => {
      try {
        const id = Number(req.params.id);
        const action = String(req.body?.action || '').trim(); // approve | correct | reject
        const notes = String(req.body?.notes || '').trim();
        const correctedClassification = req.body?.correctedClassification || null;

        if (!['approve', 'correct', 'reject'].includes(action)) {
          return res.status(400).json({ error: 'action must be: approve, correct, or reject' });
        }

        const item = deepScanDb.prepare('SELECT * FROM review_queue WHERE id = ?').get(id) as any;
        if (!item) return res.status(404).json({ error: 'Review item not found' });

        const now = Date.now();

        if (action === 'approve') {
          // If originally low-confidence, re-route to database tables
          if (item.confidence === 'low' || item.confidence === 'medium') {
            const classification = JSON.parse(item.ai_classification || '{}');
            if (classification.is_product_related && classification.mentioned_brands?.length > 0) {
              // Insert into brand_mentions as approved
              deepScanDb.prepare(`
                INSERT OR IGNORE INTO brand_mentions
                  (platform, subreddit_or_forum, post_title, post_url, author, content, mentioned_brands,
                   sentiment, discussion_type, artist_skill_level, purchase_intent, price_sensitivity, engagement_score, posted_at, scraped_at)
                VALUES (?, ?, ?, ?, 'ai_reviewed', ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
              `).run(
                item.source_type, item.source_type, item.original_title?.slice(0, 300) || '',
                item.source_url || '', item.original_text?.slice(0, 2000) || '',
                JSON.stringify(classification.mentioned_brands || []),
                classification.sentiment || 'neutral',
                classification.discussion_type || null,
                classification.artist_skill_level || 'unknown',
                classification.purchase_intent || 'not_applicable',
                classification.price_sensitivity || 'not_discussed',
                new Date().toISOString(), now
              );
            }
          }
        }

        if (action === 'correct' && correctedClassification) {
          // Store corrected version and re-route
          const classification = typeof correctedClassification === 'string'
            ? JSON.parse(correctedClassification)
            : correctedClassification;
          if (classification.is_product_related && classification.mentioned_brands?.length > 0) {
            deepScanDb.prepare(`
              INSERT OR IGNORE INTO brand_mentions
                (platform, subreddit_or_forum, post_title, post_url, author, content, mentioned_brands,
                 sentiment, discussion_type, artist_skill_level, purchase_intent, price_sensitivity, engagement_score, posted_at, scraped_at)
              VALUES (?, ?, ?, ?, 'ai_reviewed_corrected', ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
            `).run(
              item.source_type, item.source_type, item.original_title?.slice(0, 300) || '',
              item.source_url || '', item.original_text?.slice(0, 2000) || '',
              JSON.stringify(classification.mentioned_brands || []),
              classification.sentiment || 'neutral',
              classification.discussion_type || null,
              classification.artist_skill_level || 'unknown',
              classification.purchase_intent || 'not_applicable',
              classification.price_sensitivity || 'not_discussed',
              new Date().toISOString(), now
            );
          }
          // Update the stored classification
          deepScanDb.prepare('UPDATE review_queue SET ai_classification = ? WHERE id = ?').run(
            JSON.stringify(classification), id
          );
        }

        deepScanDb.prepare(`
          UPDATE review_queue
          SET review_status = ?, reviewer_notes = ?, reviewed_at = ?
          WHERE id = ?
        `).run(action === 'correct' ? 'corrected' : action === 'approve' ? 'approved' : 'rejected', notes, now, id);

        return res.json({ ok: true, id, action });
      } catch (e: any) {
        return res.status(500).json({ error: e?.message || 'review failed' });
      }
    });

    // GET /api/intel/review/stats — classification distribution for bias detection
    app.get('/api/intel/review/stats', (req, res) => {
      try {
        const reviewStats = deepScanDb.prepare(`
          SELECT review_status, COUNT(*) as c FROM review_queue GROUP BY review_status
        `).all();
        const biasCheck = deepScanDb.prepare(`
          SELECT
            json_extract(ai_classification, '$.discussion_type') as dtype,
            json_extract(ai_classification, '$.confidence') as conf,
            COUNT(*) as c
          FROM review_queue
          WHERE review_status = 'pending'
          GROUP BY dtype, conf
          ORDER BY c DESC
        `).all();
        // Overall accuracy: approved / (approved + corrected + rejected)
        const accuracy = deepScanDb.prepare(`
          SELECT
            SUM(CASE WHEN review_status = 'approved' THEN 1 ELSE 0 END) as approved,
            SUM(CASE WHEN review_status = 'corrected' THEN 1 ELSE 0 END) as corrected,
            SUM(CASE WHEN review_status = 'rejected' THEN 1 ELSE 0 END) as rejected,
            COUNT(*) as total_reviewed
          FROM review_queue
          WHERE review_status != 'pending'
        `).get() as any;

        return res.json({
          reviewStats,
          biasCheck,
          accuracy: accuracy?.total_reviewed > 0
            ? Math.round((accuracy.approved / accuracy.total_reviewed) * 100)
            : null,
          accuracyDetail: accuracy,
        });
      } catch (e: any) {
        return res.status(500).json({ error: e?.message || 'query failed' });
      }
    });

    // ========== Intel Pipeline Scheduling API ==========

    const runningPipelines: Record<string, { startedAt: number; pid: number | null }> = {};

    // GET /api/intel/status — check which pipelines are running
    app.get('/api/intel/status', (_req, res) => {
      const status: Record<string, string> = {};
      for (const [key, job] of Object.entries(runningPipelines)) {
        status[key] = job.pid !== null ? 'running' : 'completed';
      }
      return res.json({
        running: Object.keys(runningPipelines).filter(k => runningPipelines[k] && runningPipelines[k].pid !== null),
        history: Object.entries(status).map(([k, v]) => ({ pipeline: k, status: v, startedAt: runningPipelines[k]?.startedAt })),
      });
    });

    const runPipeline = (name: string, script: string, res: any) => {
      const existing = runningPipelines[name];
      if (existing && existing.pid !== null) {
        return res.status(409).json({ error: `${name} is already running`, startedAt: existing.startedAt });
      }

      const startedAt = Date.now();
      const isWin = process.platform === 'win32';
      const child = spawn(
        isWin ? 'cmd' : 'npx',
        isWin ? ['/c', 'npx', 'tsx', `scripts/${script}`] : ['tsx', `scripts/${script}`],
        {
          cwd: process.cwd(),
          stdio: 'pipe',
          env: { ...process.env },
        }
      );

      runningPipelines[name] = { startedAt, pid: child.pid };

      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
      child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });

      child.on('close', (code) => {
        runningPipelines[name].pid = null;
        console.log(`[intel] ${name} finished (exit ${code})`);
      });

      return res.json({ ok: true, pipeline: name, pid: child.pid, startedAt });
    };

    // POST /api/intel/forum/run — run forum-intel-pipeline.ts
    app.post('/api/intel/forum/run', (req, res) => {
      const dev = requireDevAuth(req, res);
      if (!dev) return;
      return runPipeline('forum', 'forum-intel-pipeline.ts', res);
    });

    // POST /api/intel/reddit/run — run reddit-monitor.ts
    app.post('/api/intel/reddit/run', (req, res) => {
      const dev = requireDevAuth(req, res);
      if (!dev) return;
      return runPipeline('reddit', 'reddit-monitor.ts', res);
    });

    // POST /api/intel/amazon/run — run amazon-review-scraper.ts
    app.post('/api/intel/amazon/run', (req, res) => {
      const dev = requireDevAuth(req, res);
      if (!dev) return;
      return runPipeline('amazon', 'amazon-review-scraper.ts', res);
    });

    // POST /api/intel/reddit/ingest — bot worker uploads scraped+classified Reddit posts
    app.post('/api/intel/reddit/ingest', (req, res) => {
      const botKey = String(req.headers['x-bot-key'] || '').trim();
      if (!botKey || botKey !== (process.env.BOT_API_KEY || 'dev_master').trim()) {
        return res.status(403).json({ error: 'bot key required' });
      }
      const { threads, classifications } = req.body || {};
      if (!Array.isArray(threads) || !Array.isArray(classifications)) {
        return res.status(400).json({ error: 'threads and classifications arrays required' });
      }

      try {
        const db = deepScanDb;
        const now = Date.now();

        const insertMention = db.prepare(`
          INSERT OR IGNORE INTO brand_mentions
            (platform, subreddit_or_forum, post_title, post_url, author, content, mentioned_brands, sentiment,
             discussion_type, artist_skill_level, purchase_intent, price_sensitivity, engagement_score, posted_at, scraped_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
        `);
        const insertReview = db.prepare(`
          INSERT INTO competitor_reviews
            (product_name, source, source_url, reviewer_name, review_text, sentiment, key_themes,
             artist_skill_level, usage_context, purchase_intent, comparison_verdict, scraped_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const insertAlert = db.prepare(`
          INSERT INTO competitor_alerts
            (brand_name, alert_type, title, details, source_url, severity, opportunity_type, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const insertQueue = db.prepare(`
          INSERT INTO review_queue (source_type, source_url, original_title, original_text, ai_classification, confidence, review_status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
        `);

        let productDiscussions = 0, reviews = 0, problems = 0, wishlists = 0, features = 0, buyers = 0;
        let skippedLow = 0, skippedMed = 0;

        for (const c of classifications) {
          const t = threads[c.index];
          if (!t || !c.is_product_related) continue;
          productDiscussions++;

          if (c.confidence === 'low') {
            skippedLow++;
            insertQueue.run('reddit', t.url, t.title, t.content?.slice(0, 2000) || '', JSON.stringify(c), 'low', now);
            continue;
          }
          const fullRoute = c.confidence === 'high';

          insertMention.run(
            'reddit', t.forum, (t.title || '').slice(0, 300), t.url, t.author,
            (t.content || '').slice(0, 2000), JSON.stringify(c.mentioned_brands || []),
            c.sentiment, c.discussion_type, c.artist_skill_level || 'unknown',
            c.purchase_intent || 'not_applicable', c.price_sensitivity || 'not_discussed',
            t.date || new Date().toISOString(), now
          );

          if (!fullRoute) { skippedMed++; continue; }

          if (c.discussion_type === 'review' || c.discussion_type === 'problem' || c.discussion_type === 'comparison') {
            if (c.discussion_type === 'review') reviews++; else if (c.discussion_type === 'problem') problems++;
            const brand = (c.mentioned_brands && c.mentioned_brands[0]) || t.forum;
            const themes = [
              ...(c.pain_points || []).map((p: string) => `PAIN: ${p}`),
              ...(c.praise_points || []).map((p: string) => `PRAISE: ${p}`),
            ];
            if (c.comparison_verdict) themes.push(`VERDICT: ${c.comparison_verdict}`);
            insertReview.run(
              brand, t.url, t.author, (t.content || '').slice(0, 1000), c.sentiment,
              JSON.stringify(themes), c.artist_skill_level || 'unknown', c.usage_context || 'unknown',
              c.purchase_intent || 'not_applicable', c.comparison_verdict || null, now
            );
          }

          if ((c.wishlist_items || []).length > 0) {
            wishlists++;
            insertAlert.run(
              (c.mentioned_brands && c.mentioned_brands[0]) || 'market_opportunity', 'product_opportunity',
              `Wishlist: ${c.wishlist_items[0]?.slice(0, 150)}`, c.key_insight || '', t.url, null, 'wishlist', now
            );
          }
          if ((c.feature_requests || []).length > 0) {
            features++;
            insertAlert.run(
              (c.mentioned_brands && c.mentioned_brands[0]) || 'unknown', 'feature_request',
              `Feature: ${c.feature_requests[0]?.slice(0, 150)}`, c.key_insight || '', t.url, null, 'feature_request', now
            );
          }
          if (c.purchase_intent === 'ready_to_buy') {
            buyers++;
            insertAlert.run(
              (c.mentioned_brands || []).join(', ') || 'unknown', 'purchase_intent',
              `Ready to buy: ${(t.title || '').slice(0, 150)}`, c.key_insight || '', t.url, null, null, now
            );
          }
        }

        return res.json({
          ok: true,
          ingested: productDiscussions,
          routed: { reviews, problems, wishlists, features, buyers },
          skipped: { lowConf: skippedLow, mediumConf: skippedMed },
        });
      } catch (e: any) {
        return res.status(500).json({ error: e?.message || 'ingest failed' });
      }
    });

    // POST /api/intel/reddit/dispatch — enqueue a reddit_scrape task for bot worker
    app.post('/api/intel/reddit/dispatch', (req, res) => {
      const dev = requireDevAuth(req, res);
      if (!dev) return;
      const subreddits = (req.body?.subreddits || 'tattoo,tattoos,tattooartists,TattooApprentice,agedtattoos').split(',').map((s: string) => s.trim());
      const postsPerSub = Number(req.body?.postsPerSub || 15);

      try {
        const db = deepScanDb;
        const now = Date.now();
        const taskIds: string[] = [];

        for (const sub of subreddits) {
          const taskId = `reddit_${sub}_${now}`;
          db.prepare(`
            INSERT INTO automation_tasks (id, payload, status, run_at, attempts, max_attempts, created_at, updated_at)
            VALUES (?, ?, 'pending', ?, 0, 3, ?, ?)
          `).run(taskId, JSON.stringify({
            taskType: 'reddit_scrape',
            subreddit: sub,
            postsPerSub,
            artistHandle: `reddit_${sub}`,
          }), now, now, now);
          taskIds.push(taskId);
        }

        return res.json({ ok: true, tasks: taskIds.length, taskIds, subreddits });
      } catch (e: any) {
        return res.status(500).json({ error: e?.message || 'dispatch failed' });
      }
    });

    // ========== DEV Account Management API ==========

    // POST /api/dev/users — Create/update user (DEV only)
    app.post('/api/dev/users', (req, res) => {
      const dev = requireDevAuth(req, res);
      if (!dev) return;
      const username = String(req.body?.username || '').trim();
      const role = String(req.body?.role || 'user').trim();
      const isActive = req.body?.isActive !== false ? 1 : 0;
      if (!username) return res.status(400).json({ error: 'username required' });

      try {
        const existing = deepScanDb.prepare('SELECT user_id FROM user_accounts WHERE username = ?').get(username) as any;
        const now = Date.now();
        let userId: string;
        let apiKey: string;

        if (existing) {
          userId = existing.user_id;
          apiKey = `dev_${username}_${now}`;
          deepScanDb.prepare(
            'UPDATE user_accounts SET api_key = ?, role = ?, is_active = ?, updated_at = ? WHERE user_id = ?'
          ).run(apiKey, role, isActive, now, userId);
        } else {
          userId = `usr_${Date.now()}`;
          apiKey = `dev_${username}_${now}`;
          deepScanDb.prepare(
            'INSERT INTO user_accounts (user_id, username, api_key, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
          ).run(userId, username, apiKey, role, isActive, now, now);
          ensureFeatureAccess(userId);
        }

        return res.json({ userId, username, role, apiKey, isActive });
      } catch (e: any) {
        return res.status(500).json({ error: e?.message || 'create user failed' });
      }
    });

    // GET /api/dev/users — List all users (DEV only)
    app.get('/api/dev/users', (req, res) => {
      const dev = requireDevAuth(req, res);
      if (!dev) return;
      try {
        const users = deepScanDb.prepare(
          'SELECT user_id, username, role, is_active, created_at, updated_at FROM user_accounts ORDER BY created_at DESC'
        ).all() as any[];

        // Attach feature access for each user
        const result = users.map(u => {
          const features = deepScanDb.prepare(
            'SELECT feature_key, enabled FROM feature_access WHERE user_id = ?'
          ).all(u.user_id) as any[];
          return { ...u, features };
        });

        return res.json({ users: result });
      } catch (e: any) {
        return res.status(500).json({ error: e?.message || 'list users failed' });
      }
    });

    // GET /api/dev/users/:userId — Get single user with features (DEV only)
    app.get('/api/dev/users/:userId', (req, res) => {
      const dev = requireDevAuth(req, res);
      if (!dev) return;
      try {
        const user = deepScanDb.prepare(
          'SELECT user_id, username, role, is_active, created_at, updated_at FROM user_accounts WHERE user_id = ?'
        ).get(req.params.userId) as any;
        if (!user) return res.status(404).json({ error: 'User not found' });

        const features = deepScanDb.prepare(
          'SELECT feature_key, enabled FROM feature_access WHERE user_id = ?'
        ).all(user.user_id) as any[];
        return res.json({ ...user, features });
      } catch (e: any) {
        return res.status(500).json({ error: e?.message || 'get user failed' });
      }
    });

    // DELETE /api/dev/users/:userId — Delete user (DEV only)
    app.delete('/api/dev/users/:userId', (req, res) => {
      const dev = requireDevAuth(req, res);
      if (!dev) return;
      try {
        const result = deepScanDb.prepare('DELETE FROM user_accounts WHERE user_id = ? AND role != ?').run(req.params.userId, 'dev');
        if (result.changes === 0) return res.status(404).json({ error: 'User not found or cannot delete DEV' });
        return res.json({ ok: true });
      } catch (e: any) {
        return res.status(500).json({ error: e?.message || 'delete user failed' });
      }
    });

    // POST /api/dev/features — Set feature access for a user (DEV only)
    app.post('/api/dev/features', (req, res) => {
      const dev = requireDevAuth(req, res);
      if (!dev) return;
      const userId = String(req.body?.userId || '').trim();
      const featureKey = String(req.body?.featureKey || '').trim();
      const enabled = req.body?.enabled === true || req.body?.enabled === 1 ? 1 : 0;
      if (!userId || !featureKey) return res.status(400).json({ error: 'userId and featureKey required' });

      try {
        const user = deepScanDb.prepare('SELECT user_id FROM user_accounts WHERE user_id = ?').get(userId) as any;
        if (!user) return res.status(404).json({ error: 'User not found' });

        deepScanDb.prepare(
          'INSERT OR REPLACE INTO feature_access (user_id, feature_key, enabled, updated_at) VALUES (?, ?, ?, ?)'
        ).run(userId, featureKey, enabled, Date.now());

        return res.json({ userId, featureKey, enabled: !!enabled });
      } catch (e: any) {
        return res.status(500).json({ error: e?.message || 'set feature failed' });
      }
    });

    // GET /api/dev/features/:userId — Get all feature access for a user
    app.get('/api/dev/features/:userId', (req, res) => {
      const dev = requireDevAuth(req, res);
      if (!dev) return;
      try {
        const features = deepScanDb.prepare(
          'SELECT feature_key, enabled FROM feature_access WHERE user_id = ?'
        ).all(req.params.userId) as any[];
        return res.json({ userId: req.params.userId, features });
      } catch (e: any) {
        return res.status(500).json({ error: e?.message || 'get features failed' });
      }
    });

    // GET /api/dev/me — Check current user's feature access (user self-check)
    app.get('/api/dev/me', (req, res) => {
      const apiKey = String(req.headers['x-dev-key'] || '').trim();
      if (!apiKey) return res.status(401).json({ error: 'x-dev-key header required' });

      try {
        const user = deepScanDb.prepare(
          'SELECT user_id, username, role FROM user_accounts WHERE api_key = ? AND is_active = 1'
        ).get(apiKey) as any;
        if (!user) return res.status(401).json({ error: 'Invalid API key' });

        const features = deepScanDb.prepare(
          'SELECT feature_key, enabled FROM feature_access WHERE user_id = ?'
        ).all(user.user_id) as any[];
        return res.json({ ...user, features });
      } catch (e: any) {
        return res.status(500).json({ error: e?.message || 'auth check failed' });
      }
    });

    app.get('/api/review/non-tattoo-candidates', async (req, res) => {
      try {
        const limitRaw = Number(req.query?.limit);
        const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(500, Math.floor(limitRaw)) : 100;
        const rows = deepScanDb
          .prepare(`
            SELECT id, bot_id, artist_id, artist_handle, profile_facts_json, created_at
            FROM bot_observations
            WHERE profile_facts_json IS NOT NULL
            ORDER BY created_at DESC
            LIMIT ?
          `)
          .all(limit) as Array<{
            id: number;
            bot_id: string;
            artist_id: string | null;
            artist_handle: string | null;
            profile_facts_json: string | null;
            created_at: number;
          }>;

        const keepRows = deepScanDb
          .prepare(`SELECT artist_handle FROM review_overrides WHERE action = 'keep'`)
          .all() as Array<{ artist_handle: string }>;
        const keepSet = new Set(
          keepRows
            .map((r) => String(r.artist_handle || '').replace(/^@/, '').trim().toLowerCase())
            .filter(Boolean)
        );

        const out: any[] = [];
        for (const r of rows) {
          let pf: any = {};
          try { pf = r.profile_facts_json ? JSON.parse(r.profile_facts_json) : {}; } catch {}
          if (pf?.nonTattooSuspect !== true) continue;
          const handle = String(r.artist_handle || '').replace(/^@/, '').trim();
          if (handle && keepSet.has(handle.toLowerCase())) continue;
          let artist: any = null;
          if (r.artist_id) {
            const x = await sql`SELECT id, shop_name, ig_handle, city, import_region FROM artists WHERE id = ${String(r.artist_id)} LIMIT 1`;
            artist = (x as any[])[0] || null;
          } else if (handle) {
            const x = await sql`SELECT id, shop_name, ig_handle, city, import_region FROM artists WHERE ig_handle ILIKE ${'%' + handle + '%'} LIMIT 1`;
            artist = (x as any[])[0] || null;
          }
          out.push({
            observationId: r.id,
            botId: r.bot_id,
            artistId: artist?.id || r.artist_id || null,
            artistHandle: handle || null,
            shopName: artist?.shop_name || null,
            city: artist?.city || null,
            importRegion: artist?.import_region || null,
            profileFacts: pf,
            createdAt: new Date(Number(r.created_at)).toISOString()
          });
        }
        return res.json({ total: out.length, rows: out });
      } catch (e: any) {
        return res.status(500).json({ error: 'review_candidates_failed', details: e?.message || String(e) });
      }
    });

    app.post('/api/review/delete-artist', async (req, res) => {
      try {
        const artistId = String(req.body?.artistId || '').trim();
        const artistHandle = String(req.body?.artistHandle || '').replace(/^@/, '').trim();
        const observationId = Number(req.body?.observationId) || 0;
        let ids: string[] = [];
        if (artistId) ids = [artistId];
        else if (artistHandle) {
          const found = await sql`SELECT id FROM artists WHERE ig_handle ILIKE ${'%' + artistHandle + '%'} LIMIT 20`;
          ids = (found as any[]).map((x) => String(x.id || '')).filter(Boolean);
        }

        // Always delete from bot_observations (handles observation-only entries like visionexpress)
        if (observationId > 0) {
          deepScanDb.prepare(`DELETE FROM bot_observations WHERE id = ?`).run(observationId);
        } else if (artistHandle) {
          deepScanDb.prepare(`DELETE FROM bot_observations WHERE artist_handle = ?`).run(artistHandle);
        }

        // Add to review_overrides as 'deleted' so non-tattoo-candidates filter it out
        if (artistHandle) {
          deepScanDb.prepare(`
            INSERT INTO review_overrides (artist_handle, action, updated_at)
            VALUES (?, 'deleted', ?)
            ON CONFLICT(artist_handle) DO UPDATE SET action = 'deleted', updated_at = excluded.updated_at
          `).run(artistHandle, Date.now());
        }

        if (ids.length === 0) {
          return res.json({ ok: true, deletedArtistIds: [], deletedCount: 0, observationDeleted: true });
        }

        await sql`DELETE FROM artists WHERE id = ANY(${ids}::text[])`;
        const delTaskStmt = deepScanDb.prepare(`
          DELETE FROM automation_tasks
          WHERE json_extract(payload, '$.artistId') = ?
        `);
        ids.forEach((id) => delTaskStmt.run(id));
        return res.json({ ok: true, deletedArtistIds: ids, deletedCount: ids.length, observationDeleted: true });
      } catch (e: any) {
        return res.status(500).json({ error: 'review_delete_artist_failed', details: e?.message || String(e) });
      }
    });

    app.post('/api/review/keep-and-requeue', async (req, res) => {
      try {
        const artistId = String(req.body?.artistId || '').trim();
        const artistHandleRaw = String(req.body?.artistHandle || '').replace(/^@/, '').trim();
        const behaviorProfile = String(req.body?.behaviorProfile || 'warmup');
        const language = String(req.body?.language || 'en');

        let resolvedArtistId = artistId;
        let resolvedHandle = artistHandleRaw;

        if (!resolvedArtistId && resolvedHandle) {
          const found = await sql`
            SELECT id, ig_handle FROM artists WHERE ig_handle ILIKE ${'%' + resolvedHandle + '%'} LIMIT 1
          `;
          const row = (found as any[])[0];
          if (row) {
            resolvedArtistId = String(row.id || '');
            const m = String(row.ig_handle || '').match(/instagram\.com\/([a-zA-Z0-9._-]+)/i);
            resolvedHandle = m?.[1] || String(row.ig_handle || '').replace(/^@/, '').trim();
          }
        }
        if (!resolvedHandle) return res.status(400).json({ error: 'artistHandle is required' });
        if (!resolvedArtistId) resolvedArtistId = `manual_keep_${resolvedHandle}`;

        const now = Date.now();
        deepScanDb
          .prepare(`
            INSERT INTO review_overrides (artist_handle, action, updated_at)
            VALUES (?, 'keep', ?)
            ON CONFLICT(artist_handle) DO UPDATE SET
              action = 'keep',
              updated_at = excluded.updated_at
          `)
          .run(resolvedHandle.toLowerCase(), now);

        // Ensure this handle exists in artists (so it's "restored" to DB list).
        const existingArtist = await sql`
          SELECT id, shop_name, ig_handle, import_region
          FROM artists
          WHERE id = ${resolvedArtistId}
             OR ig_handle ILIKE ${'%' + resolvedHandle + '%'}
          LIMIT 1
        `;
        if ((existingArtist as any[]).length === 0) {
          const obs = deepScanDb
            .prepare(`
              SELECT profile_facts_json
              FROM bot_observations
              WHERE lower(artist_handle) = lower(?)
              ORDER BY created_at DESC
              LIMIT 1
            `)
            .get(resolvedHandle) as { profile_facts_json: string | null } | undefined;
          let shopName = resolvedHandle;
          let profileFacts: any = {};
          try { profileFacts = obs?.profile_facts_json ? JSON.parse(obs.profile_facts_json) : {}; } catch {}
          const title = String(profileFacts?.title || '').trim();
          if (title) {
            shopName = title;
          } else {
            shopName = resolvedHandle.replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
          }
          await sql`
            INSERT INTO artists (
              id, shop_name, ig_handle, city, import_region, source_type, entity_type, last_updated
            ) VALUES (
              ${resolvedArtistId},
              ${shopName},
              ${'https://www.instagram.com/' + resolvedHandle},
              ${'Unknown'},
              ${'WA'},
              ${'manual_review'},
              ${'tattoo_shop'},
              NOW()
            )
            ON CONFLICT (id) DO UPDATE SET
              shop_name = COALESCE(NULLIF(EXCLUDED.shop_name, ''), artists.shop_name),
              ig_handle = COALESCE(NULLIF(EXCLUDED.ig_handle, ''), artists.ig_handle),
              last_updated = NOW()
          `;
        }

        const exists = deepScanDb.prepare(`
          SELECT id FROM automation_tasks
          WHERE status IN ('pending','leased','running')
            AND json_extract(payload, '$.artistId') = ?
          LIMIT 1
        `).get(resolvedArtistId) as { id: string } | undefined;
        if (exists?.id) return res.json({ ok: true, queued: false, reason: 'already_queued', commandId: exists.id });

        const commandId = `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const payload = {
          id: commandId,
          artistId: resolvedArtistId,
          artistHandle: resolvedHandle,
          behaviorProfile,
          language,
          source: 'manual_review_keep',
          timestamp: new Date().toISOString(),
          suggestedExecMode: 'browse_only'
        };
        deepScanDb.prepare(`
          INSERT INTO automation_tasks (
            id, payload, status, run_at, lease_until, leased_by, attempts, max_attempts, error_reason, created_at, updated_at
          ) VALUES (?, ?, 'pending', ?, NULL, NULL, 0, 3, NULL, ?, ?)
        `).run(commandId, JSON.stringify(payload), now, now, now);

        return res.json({ ok: true, queued: true, commandId, artistId: resolvedArtistId, artistHandle: resolvedHandle });
      } catch (e: any) {
        return res.status(500).json({ error: 'review_keep_requeue_failed', details: e?.message || String(e) });
      }
    });

    app.get('/api/review/kept-candidates', async (req, res) => {
      try {
        const limitRaw = Number(req.query?.limit);
        const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(1000, Math.floor(limitRaw)) : 200;
        const rows = deepScanDb
          .prepare(`
            SELECT artist_handle, action, updated_at
            FROM review_overrides
            WHERE action = 'keep'
            ORDER BY updated_at DESC
            LIMIT ?
          `)
          .all(limit) as Array<{ artist_handle: string; action: string; updated_at: number }>;

        const out: any[] = [];
        for (const r of rows) {
          const handle = String(r.artist_handle || '').replace(/^@/, '').trim();
          let artist: any = null;
          if (handle) {
            const x = await sql`
              SELECT id, shop_name, ig_handle, city, import_region, email, website
              FROM artists
              WHERE ig_handle ILIKE ${'%' + handle + '%'}
              LIMIT 1
            `;
            artist = (x as any[])[0] || null;
          }
          out.push({
            artistHandle: handle,
            artistId: artist?.id || null,
            shopName: artist?.shop_name || null,
            city: artist?.city || null,
            importRegion: artist?.import_region || null,
            email: artist?.email || null,
            website: artist?.website || null,
            updatedAt: new Date(Number(r.updated_at || Date.now())).toISOString()
          });
        }
        return res.json({ total: out.length, rows: out });
      } catch (e: any) {
        return res.status(500).json({ error: 'kept_candidates_failed', details: e?.message || String(e) });
      }
    });

    app.post('/api/review/unkeep-candidate', async (req, res) => {
      try {
        const artistHandle = String(req.body?.artistHandle || '').replace(/^@/, '').trim().toLowerCase();
        if (!artistHandle) return res.status(400).json({ error: 'artistHandle is required' });
        const result = deepScanDb
          .prepare(`DELETE FROM review_overrides WHERE lower(artist_handle) = lower(?)`)
          .run(artistHandle);
        return res.json({ ok: true, deleted: Number(result.changes || 0), artistHandle });
      } catch (e: any) {
        return res.status(500).json({ error: 'unkeep_candidate_failed', details: e?.message || String(e) });
      }
    });

    app.post('/api/data/cleanup-non-tattoo', async (req, res) => {
      try {
        const state = String(req.body?.state || '').trim();
        const dryRun = req.body?.dryRun === true;
        const rows = state
          ? await sql`
              SELECT id, shop_name, website, address, ig_handle, import_region
              FROM artists
              WHERE source_type IN ('maps_scrape', 'csv_import')
                AND (import_region = ${state} OR import_region = ${state.toUpperCase()})
            `
          : await sql`
              SELECT id, shop_name, website, address, ig_handle, import_region
              FROM artists
              WHERE source_type IN ('maps_scrape', 'csv_import')
            `;

        const bad = (rows as any[]).filter((r) => !isTattooEntity(r));
        if (dryRun) {
          return res.json({
            ok: true,
            dryRun: true,
            state: state || 'ALL',
            totalChecked: rows.length,
            deleteCount: bad.length,
            sample: bad.slice(0, 20).map((x) => ({ id: x.id, shop_name: x.shop_name, ig_handle: x.ig_handle, import_region: x.import_region }))
          });
        }

        const ids = bad.map((x) => String(x.id || '')).filter(Boolean);
        if (ids.length > 0) {
          await sql`DELETE FROM artists WHERE id = ANY(${ids}::text[])`;
        }
        return res.json({
          ok: true,
          dryRun: false,
          state: state || 'ALL',
          totalChecked: rows.length,
          deleted: ids.length
        });
      } catch (e: any) {
        return res.status(500).json({ error: 'cleanup_non_tattoo_failed', details: e?.message || String(e) });
      }
    });

    app.post('/api/data/dedup-artists', async (req, res) => {
      try {
        const dryRun = req.body?.dryRun !== false;
        const mode = String(req.body?.mode || 'name_city').trim();
        // mode: 'name_only' = merge same shop_name, 'name_city' (default) = merge same shop_name + city

        const groupBy = mode === 'name_only'
          ? sql`LOWER(shop_name)`
          : sql`LOWER(shop_name) || '||' || LOWER(COALESCE(city, ''))`;

        const dupes = await sql`
          SELECT ${groupBy} AS group_key,
            COUNT(*) AS cnt,
            ARRAY_AGG(id ORDER BY last_updated DESC NULLS LAST) AS ids
          FROM artists
          WHERE shop_name IS NOT NULL AND shop_name <> ''
          GROUP BY ${groupBy}
          HAVING COUNT(*) > 1
          ORDER BY cnt DESC
        `;
        const results: any[] = [];
        let removed = 0;
        const stats = { sameCity: 0, diffCity: 0, withIgHandle: 0, withoutIgHandle: 0 };

        for (const group of dupes as any[]) {
          const ids: string[] = group.ids;
          const keepId = ids[0];
          const dupeIds = ids.slice(1);

          // Check if all rows in this group share the same city
          const cities = await sql`
            SELECT DISTINCT city FROM artists
            WHERE id = ANY(${ids}::text[]) AND city IS NOT NULL AND city <> ''
          `;
          const sameCity = cities.length <= 1;
          if (sameCity) stats.sameCity++;
          else stats.diffCity++;

          // Check IG handle presence on kept row
          const keepRow = await sql`SELECT ig_handle, city FROM artists WHERE id = ${keepId} LIMIT 1`;
          const hasIg = keepRow.length > 0 && keepRow[0].ig_handle;
          if (hasIg) stats.withIgHandle++;
          else stats.withoutIgHandle++;

          const entry: any = {
            group_key: group.group_key, cnt: group.cnt,
            keepId, dupeIds, sameCity,
            keepHasIg: !!hasIg, merged: false, skipped: false
          };

          if (!dryRun) {
            // Merge ig_handle from a dupe if keeper has none
            if (!hasIg) {
              const dupesWithIg = await sql`
                SELECT ig_handle FROM artists
                WHERE id = ANY(${dupeIds}::text[]) AND ig_handle IS NOT NULL AND ig_handle <> ''
                LIMIT 1
              `;
              if (dupesWithIg.length > 0) {
                await sql`UPDATE artists SET ig_handle = ${dupesWithIg[0].ig_handle} WHERE id = ${keepId}`;
              }
            }
            // Delete duplicates
            await sql`DELETE FROM artists WHERE id = ANY(${dupeIds}::text[])`;
            entry.merged = true;
          }
          removed += dupeIds.length;
          results.push(entry);
        }

        return res.json({
          ok: true, dryRun, mode,
          duplicateGroups: results.length,
          totalDupeRows: removed,
          stats,
          details: results.slice(0, 100)
        });
      } catch (e: any) {
        return res.status(500).json({ error: 'dedup_artists_failed', details: e?.message || String(e) });
      }
    });

    app.post('/api/data/cleanup-artists', async (req, res) => {
      try {
        const dryRun = req.body?.dryRun !== false;
        const scope = String(req.body?.scope || 'all');

        const conditions: string[] = [];
        let deleteAll = false;
        if (scope === 'all') {
          deleteAll = true;
        } else {
          if (scope === 'shopify') {
            conditions.push(`LOWER(shop_name) = 'shopify customer'`);
          }
          if (scope === 'null_source') {
            conditions.push(`source_type IS NULL`);
          }
          if (conditions.length === 0) {
            return res.status(400).json({ error: 'no_valid_scope', scopes: ['shopify', 'null_source', 'all'] });
          }
        }

        let totalAffected = 0;
        if (dryRun) {
          if (deleteAll) {
            const count = await sql.query('SELECT COUNT(*) AS c FROM artists');
            totalAffected = parseInt(count[0]?.c || '0', 10);
          } else {
            const count = await sql.query(`SELECT COUNT(*) AS c FROM artists WHERE ${conditions.join(' OR ')}`);
            totalAffected = parseInt(count[0]?.c || '0', 10);
          }
          return res.json({ ok: true, dryRun: true, scope, totalAffected });
        }

        if (deleteAll) {
          const count = await sql.query('SELECT COUNT(*) AS c FROM artists');
          totalAffected = parseInt(count[0]?.c || '0', 10);
          await sql.query('DELETE FROM artists');
        } else {
          const whereClause = conditions.join(' OR ');
          const count = await sql.query(`SELECT COUNT(*) AS c FROM artists WHERE ${whereClause}`);
          totalAffected = parseInt(count[0]?.c || '0', 10);
          await sql.query(`DELETE FROM artists WHERE ${whereClause}`);
        }
        return res.json({ ok: true, dryRun: false, scope, deleted: totalAffected });
      } catch (e: any) {
        return res.status(500).json({ error: 'cleanup_artists_failed', details: e?.message || String(e) });
      }
    });

    app.post('/api/data/recover-from-observations', async (req, res) => {
      try {
        const state = String(req.body?.state || 'WA').trim();
        const limitRaw = Number(req.body?.limit);
        const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(1000, Math.floor(limitRaw)) : 200;
        const rows = deepScanDb
          .prepare(`
            SELECT artist_handle
            FROM bot_observations
            WHERE artist_handle IS NOT NULL AND trim(artist_handle) <> ''
            ORDER BY created_at DESC
            LIMIT ?
          `)
          .all(limit) as Array<{ artist_handle: string }>;

        const handles = Array.from(new Set(rows.map((r) => String(r.artist_handle || '').replace(/^@/, '').trim().toLowerCase()).filter(Boolean)));
        let recovered = 0;
        let existed = 0;
        for (const h of handles) {
          const existing = await sql`
            SELECT id FROM artists WHERE ig_handle ILIKE ${'%' + h + '%'} LIMIT 1
          `;
          if ((existing as any[]).length > 0) {
            existed += 1;
            continue;
          }
          const id = `recovered_${h}`;
          const shopName = h.replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
          await sql`
            INSERT INTO artists (
              id, shop_name, ig_handle, city, import_region, source_type, entity_type, last_updated
            ) VALUES (
              ${id}, ${shopName}, ${'https://www.instagram.com/' + h}, ${'Unknown'}, ${state}, ${'maps_scrape'}, ${'tattoo_shop'}, NOW()
            )
            ON CONFLICT (id) DO NOTHING
          `;
          recovered += 1;
        }

        return res.json({
          ok: true,
          state,
          scannedHandles: handles.length,
          recovered,
          existed
        });
      } catch (e: any) {
        return res.status(500).json({ error: 'recover_from_observations_failed', details: e?.message || String(e) });
      }
    });

    app.post('/api/data/recover-from-scraped-shops', async (req, res) => {
      try {
        const state = String(req.body?.state || 'WA').trim();
        const limitRaw = Number(req.body?.limit);
        const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(5000, Math.floor(limitRaw)) : 1000;

        const rows = state
          ? await sql`
              SELECT city, shop_name, address, phone, website, instagram, facebook, email
              FROM scraped_shops
              WHERE city IS NOT NULL
              ORDER BY scraped_at DESC
              LIMIT ${limit}
            `
          : await sql`
              SELECT city, shop_name, address, phone, website, instagram, facebook, email
              FROM scraped_shops
              ORDER BY scraped_at DESC
              LIMIT ${limit}
            `;

        const parseHandle = (v: string) => {
          const x = String(v || '').trim();
          if (!x) return '';
          const m = x.match(/instagram\.com\/([a-zA-Z0-9._-]+)/i);
          if (m?.[1]) return m[1];
          return x.replace(/^@/, '').trim();
        };

        let recovered = 0;
        let existed = 0;
        for (const r of rows as any[]) {
          const handle = parseHandle(String(r.instagram || ''));
          if (!handle) continue;

          const existing = await sql`
            SELECT id FROM artists WHERE ig_handle ILIKE ${'%' + handle + '%'} LIMIT 1
          `;
          if ((existing as any[]).length > 0) {
            existed += 1;
            continue;
          }

          const id = `recovered_scrape_${handle}`;
          const shopName = String(r.shop_name || handle).trim().slice(0, 180);
          const city = String(r.city || 'Unknown').trim().slice(0, 80);
          const website = String(r.website || '').trim();
          const facebook = String(r.facebook || '').trim();
          const email = String(r.email || '').trim();
          const phone = String(r.phone || '').trim();
          const address = String(r.address || '').trim();
          const igUrl = `https://www.instagram.com/${handle}`;

          await sql`
            INSERT INTO artists (
              id, shop_name, address, phone, website, ig_handle, facebook, email, city, import_region, source_type, entity_type, last_updated
            ) VALUES (
              ${id}, ${shopName}, ${address || null}, ${phone || null}, ${website || null}, ${igUrl}, ${facebook || null}, ${email || null}, ${city}, ${state}, ${'maps_scrape'}, ${'tattoo_shop'}, NOW()
            )
            ON CONFLICT (id) DO NOTHING
          `;
          recovered += 1;
        }

        return res.json({
          ok: true,
          state,
          scanned: rows.length,
          recovered,
          existed
        });
      } catch (e: any) {
        return res.status(500).json({ error: 'recover_from_scraped_shops_failed', details: e?.message || String(e) });
      }
    });

    app.get('/api/bot/online', (req, res) => {
      const rows = deepScanDb
        .prepare('SELECT bot_id, payload, status, last_heartbeat_at, updated_at FROM bot_instances ORDER BY last_heartbeat_at DESC LIMIT 500')
        .all() as Array<{ bot_id: string; payload: string; status: string; last_heartbeat_at: number; updated_at: number }>;
      const now = Date.now();
      const bots = rows.map((row) => {
        let payload: BotInstancePayload | null = null;
        try {
          payload = JSON.parse(row.payload) as BotInstancePayload;
        } catch {
          payload = null;
        }
        const staleMs = now - Number(row.last_heartbeat_at || 0);
        const paused = String(row.status || '') === 'paused';
        const online = staleMs <= BOT_ONLINE_TTL_MS && !paused;
        const profile = getBotProfile(row.bot_id);
        const todaySpeed = getDailySpeedFactor(profile);
        return {
          botId: row.bot_id,
          accountIds: payload?.accountIds || [],
          host: payload?.host || null,
          ip: payload?.ip || null,
          version: payload?.version || null,
          status: paused ? 'paused' : (online ? 'online' : 'offline'),
          lastHeartbeatAt: new Date(Number(row.last_heartbeat_at || 0)).toISOString(),
          staleMs,
          profile: {
            hash: profile.hash,
            typing: profile.typing,
            browsing: { ...profile.browsing, todaySpeed },
            viewport: profile.viewport,
            commentStyleSeed: profile.commentStyleSeed
          }
        };
      });
      return res.json({ total: bots.length, online: bots.filter((b) => b.status === 'online').length, bots });
    });

    // GET /api/bot/health — health monitoring with alerts (26)
    app.get('/api/bot/health', (req, res) => {
      const rows = deepScanDb
        .prepare('SELECT bot_id, payload, status, last_heartbeat_at, updated_at FROM bot_instances ORDER BY last_heartbeat_at DESC LIMIT 500')
        .all() as Array<{ bot_id: string; payload: string; status: string; last_heartbeat_at: number; updated_at: number }>;
      const now = Date.now();
      const bots = rows.map((row) => {
        let payload: BotInstancePayload | null = null;
        try { payload = JSON.parse(row.payload) as BotInstancePayload; } catch { payload = null; }
        const staleMs = now - Number(row.last_heartbeat_at || 0);
        const paused = String(row.status || '') === 'paused';
        const online = staleMs <= BOT_ONLINE_TTL_MS && !paused;
        let alert: 'none' | 'warning' | 'critical' = 'none';
        if (!online && !paused) {
          if (staleMs > 300000) alert = 'critical';      // 5min+ offline
          else if (staleMs > 120000) alert = 'warning';    // 2min+ offline
        }
        return {
          botId: row.bot_id,
          status: paused ? 'paused' : (online ? 'online' : 'offline'),
          lastHeartbeatAt: new Date(Number(row.last_heartbeat_at || 0)).toISOString(),
          lastHeartbeatTs: Number(row.last_heartbeat_at || 0),
          staleMs,
          alert,
          host: payload?.host || null,
          ip: payload?.ip || null,
          version: payload?.version || null,
          accountIds: payload?.accountIds || [],
        };
      });
      const total = bots.length;
      const online = bots.filter(b => b.status === 'online').length;
      const offline = bots.filter(b => b.status === 'offline').length;
      const paused = bots.filter(b => b.status === 'paused').length;
      const criticalAlerts = bots.filter(b => b.alert === 'critical').length;
      const warningAlerts = bots.filter(b => b.alert === 'warning').length;
      return res.json({ total, online, offline, paused, criticalAlerts, warningAlerts, bots });
    });

    // ========== Marketing Scripts & Tasks API ==========

    // GET /api/marketing/scripts — list all, filterable by category
    app.get('/api/marketing/scripts', (req, res) => {
      const category = String(req.query?.category || '').trim();
      const activeOnly = String(req.query?.active || 'true') !== 'false';
      let sql = `SELECT * FROM marketing_scripts WHERE 1=1`;
      const params: any[] = [];
      if (category) { sql += ` AND category = ?`; params.push(category); }
      if (activeOnly) { sql += ` AND active = 1`; }
      sql += ` ORDER BY category ASC, success_rate DESC, usage_count ASC`;
      const rows = deepScanDb.prepare(sql).all(...params);
      return res.json({ ok: true, total: (rows as any[]).length, scripts: rows });
    });

    // POST /api/marketing/scripts — create or update
    app.post('/api/marketing/scripts', (req, res) => {
      const { id, category, direction, title, content, tone, tags, match_conditions } = req.body || {};
      if (!category || !content) return res.status(400).json({ error: 'category and content required' });
      const now = Date.now();
      if (id) {
        deepScanDb.prepare(`
          UPDATE marketing_scripts SET category=?, direction=?, title=?, content=?, tone=?, tags=?, match_conditions=?, updated_at=?
          WHERE id=?
        `).run(
          String(category), String(direction || ''), String(title || ''), String(content),
          String(tone || 'professional'), String(tags || ''), JSON.stringify(match_conditions || {}),
          now, Number(id)
        );
        return res.json({ ok: true, updated: true });
      } else {
        const result = deepScanDb.prepare(`
          INSERT INTO marketing_scripts (category, direction, title, content, tone, tags, match_conditions, active, usage_count, success_rate, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, 0, ?, ?)
        `).run(
          String(category), String(direction || ''), String(title || ''), String(content),
          String(tone || 'professional'), String(tags || ''), JSON.stringify(match_conditions || {}),
          now, now
        );
        return res.json({ ok: true, id: result.lastInsertRowid });
      }
    });

    // DELETE /api/marketing/scripts/:id
    app.delete('/api/marketing/scripts/:id', (req, res) => {
      const id = Number(req.params?.id);
      if (!id) return res.status(400).json({ error: 'id required' });
      deepScanDb.prepare(`DELETE FROM marketing_scripts WHERE id = ?`).run(id);
      return res.json({ ok: true, deleted: true });
    });

    // POST /api/marketing/scripts/select — auto-select best script for a target
    app.post('/api/marketing/scripts/select', (req, res) => {
      const { category, profileFacts } = req.body || {};
      const cat = String(category || 'industry_talk').trim();
      const scripts = deepScanDb.prepare(`
        SELECT * FROM marketing_scripts WHERE category = ? AND active = 1 ORDER BY success_rate DESC, usage_count ASC
      `).all(cat) as Array<any>;
      if (scripts.length === 0) {
        return res.json({ ok: true, selected: null });
      }
      // If we have profile signals, try to match by direction/tags
      let selected = scripts[0];  // default: best success rate
      if (profileFacts) {
        const followers = Number(profileFacts.followers || 0);
        const hasWebsite = String(profileFacts.externalUrl || '').length > 0;
        for (const s of scripts) {
          const direction = String(s.direction || '');
          if (followers >= 5000 && direction === 'sample_review') { selected = s; break; }
          if (hasWebsite && direction === 'website_visit') { selected = s; break; }
        }
      }
      // Increment usage count
      deepScanDb.prepare(`UPDATE marketing_scripts SET usage_count = usage_count + 1 WHERE id = ?`).run(selected.id);
      return res.json({ ok: true, selected });
    });

    // GET /api/marketing/tasks/poll — bot polls for pending DM marketing tasks
    app.get('/api/marketing/tasks/poll', (req, res) => {
      if (!requireBotAuth(req, res)) return;
      const botId = String(req.query?.botId || '').trim();
      const limit = Math.max(1, Math.min(10, Number(req.query?.limit || 3)));
      if (!botId) return res.status(400).json({ error: 'botId required' });

      const now = Date.now();
      // Lease up to `limit` pending tasks
      const pending = deepScanDb.prepare(`
        SELECT id FROM marketing_tasks
        WHERE status = 'pending' AND (bot_id IS NULL OR bot_id = ?)
        ORDER BY lead_score DESC, created_at ASC
        LIMIT ?
      `).all(botId, limit) as Array<{ id: number }>;

      const leased: any[] = [];
      for (const row of pending) {
        const updated = deepScanDb.prepare(`
          UPDATE marketing_tasks SET status = 'sent', bot_id = ?, sent_at = ?, updated_at = ?
          WHERE id = ? AND status = 'pending'
        `).run(botId, now, now, row.id);
        if ((updated.changes || 0) > 0) {
          const task = deepScanDb.prepare(`SELECT * FROM marketing_tasks WHERE id = ?`).get(row.id);
          if (task) leased.push(task);
        }
      }
      return res.json({ ok: true, tasks: leased });
    });

    // POST /api/marketing/tasks/report — bot reports DM outcome
    app.post('/api/marketing/tasks/report', (req, res) => {
      if (!requireBotAuth(req, res)) return;
      const { taskId, status, replyText, botId } = req.body || {};
      if (!taskId || !status) return res.status(400).json({ error: 'taskId and status required' });
      const now = Date.now();
      const validStatuses = ['replied', 'converted', 'failed', 'pending'];
      if (!validStatuses.includes(status)) return res.status(400).json({ error: `invalid status: ${status}` });

      const updateData: Record<string, any> = { updated_at: now };
      if (status === 'replied') updateData.reply_at = now;
      if (status === 'converted') updateData.converted_at = now;
      if (replyText) updateData.reply_text = String(replyText).slice(0, 2000);

      const setClauses = Object.keys(updateData).map(k => `${k} = ?`).join(', ');
      const values = Object.values(updateData);
      deepScanDb.prepare(`UPDATE marketing_tasks SET status = ?, ${setClauses} WHERE id = ?`).run(status, ...values, Number(taskId));

      // CRM Stage Progression: DM status → artist lifecycle stage
      const task = deepScanDb.prepare(`SELECT target_handle, artist_id FROM marketing_tasks WHERE id = ?`).get(Number(taskId)) as any;
      if (task?.artist_id) {
        const stageMap: Record<string, string> = {
          'sent': 'warm',
          'replied': 'engaged',
          'converted': 'customer',
        };
        const newStage = stageMap[status];
        if (newStage) {
          sql`
            UPDATE artists SET stage = ${newStage}, last_updated = NOW()
            WHERE id = ${task.artist_id} AND stage != 'customer'
          `.catch(() => {});
        }
      }
      return res.json({ ok: true, taskId, status });
    });

    // GET /api/marketing/tasks/stats — aggregate stats
    app.get('/api/marketing/tasks/stats', (_req, res) => {
      const rows = deepScanDb.prepare(`
        SELECT status, COUNT(*) AS cnt FROM marketing_tasks GROUP BY status
      `).all() as Array<{ status: string; cnt: number }>;
      const counts: Record<string, number> = { pending: 0, sent: 0, replied: 0, converted: 0, failed: 0 };
      for (const r of rows) counts[String(r.status || 'unknown')] = Number(r.cnt || 0);
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      // Also calculate conversion rate
      const sent = counts.sent + counts.replied + counts.converted;
      const conversionRate = sent > 0 ? Math.round((counts.converted / sent) * 100) : 0;
      return res.json({ ok: true, total, counts, conversionRate });
    });

    // GET /api/marketing/scripts/ab-test — A/B test analysis: compare script performance by category (27)
    app.get('/api/marketing/scripts/ab-test', (_req, res) => {
      try {
        const scripts = deepScanDb.prepare(`
          SELECT * FROM marketing_scripts ORDER BY category, usage_count DESC
        `).all() as Array<Record<string, any>>;

        // Get task stats per script_id
        const taskStats = deepScanDb.prepare(`
          SELECT script_id, status, COUNT(*) AS cnt FROM marketing_tasks
          WHERE script_id IS NOT NULL
          GROUP BY script_id, status
        `).all() as Array<{ script_id: number; status: string; cnt: number }>;

        // Build per-script stats map
        const scriptTaskMap: Record<number, Record<string, number>> = {};
        for (const t of taskStats) {
          if (!scriptTaskMap[t.script_id]) scriptTaskMap[t.script_id] = {};
          scriptTaskMap[t.script_id][t.status] = (scriptTaskMap[t.script_id][t.status] || 0) + Number(t.cnt);
        }

        // Group by category
        const categoryMap: Record<string, any[]> = {};
        for (const s of scripts) {
          const stats = scriptTaskMap[s.id] || {};
          const sent = (stats.sent || 0) + (stats.replied || 0) + (stats.converted || 0);
          const replied = stats.replied || 0;
          const converted = stats.converted || 0;
          const successRate = sent > 0 ? Math.round(((replied + converted) / sent) * 100) : 0;
          const conversionRate = sent > 0 ? Math.round((converted / sent) * 100) : 0;

          if (!categoryMap[s.category]) categoryMap[s.category] = [];
          categoryMap[s.category].push({
            id: s.id,
            title: s.title,
            tone: s.tone,
            direction: s.direction,
            active: Boolean(s.active),
            usageCount: Number(s.usage_count || 0),
            taskSentCount: sent,
            taskRepliedCount: replied,
            taskConvertedCount: converted,
            successRate,
            conversionRate
          });
        }

        const categories = Object.entries(categoryMap).map(([category, scripts]) => {
          scripts.sort((a, b) => (b.conversionRate - a.conversionRate) || (b.usageCount - a.usageCount));
          const bestScript = scripts.length > 0 ? { id: scripts[0].id, title: scripts[0].title, conversionRate: scripts[0].conversionRate, successRate: scripts[0].successRate } : null;
          return { category, scriptCount: scripts.length, scripts, bestScript };
        });

        return res.json({ ok: true, categories });
      } catch (e: any) {
        return res.status(500).json({ error: 'ab_test_failed', details: e?.message || String(e) });
      }
    });

    // POST /api/marketing/scripts/auto-optimize — auto-disable poor performers, keep best active (27)
    app.post('/api/marketing/scripts/auto-optimize', (_req, res) => {
      // Get A/B analysis
      const scripts = deepScanDb.prepare(`
        SELECT * FROM marketing_scripts ORDER BY category, usage_count DESC
      `).all() as Array<Record<string, any>>;
      const taskStats = deepScanDb.prepare(`
        SELECT script_id, status, COUNT(*) AS cnt FROM marketing_tasks
        WHERE script_id IS NOT NULL
        GROUP BY script_id, status
      `).all() as Array<{ script_id: number; status: string; cnt: number }>;

      const scriptTaskMap: Record<number, Record<string, number>> = {};
      for (const t of taskStats) {
        if (!scriptTaskMap[t.script_id]) scriptTaskMap[t.script_id] = {};
        scriptTaskMap[t.script_id][t.status] = (scriptTaskMap[t.script_id][t.status] || 0) + Number(t.cnt);
      }

      const changed: string[] = [];
      const categories = [...new Set(scripts.map(s => s.category))];

      for (const category of categories) {
        const catScripts = scripts.filter(s => s.category === category);
        const withStats = catScripts.map(s => {
          const stats = scriptTaskMap[s.id] || {};
          const sent = (stats.sent || 0) + (stats.replied || 0) + (stats.converted || 0);
          const converted = stats.converted || 0;
          return { ...s, sent, converted, conversionRate: sent > 0 ? Math.round((converted / sent) * 100) : 0 };
        });

        // Sort by conversion rate
        withStats.sort((a, b) => (b.conversionRate - a.conversionRate) || (b.sent - a.sent));

        // Best performer: ensure it's active
        if (withStats.length > 0 && withStats[0].sent >= 3) {
          const best = withStats[0];
          if (!best.active) {
            deepScanDb.prepare(`UPDATE marketing_scripts SET active = 1, updated_at = ? WHERE id = ?`).run(Date.now(), best.id);
            changed.push(`activated best "${best.title}" (${category}, ${best.conversionRate}% conv)`);
          }
        }

        // Poor performers: disable if < 5% conversion rate with >= 5 sent
        for (const s of withStats) {
          if (s.sent >= 5 && s.conversionRate < 5 && s.active) {
            deepScanDb.prepare(`UPDATE marketing_scripts SET active = 0, updated_at = ? WHERE id = ?`).run(Date.now(), s.id);
            changed.push(`disabled "${s.title}" (${category}, ${s.conversionRate}% conv, ${s.sent} sent)`);
          }
        }
      }

      if (changed.length === 0) changed.push('no changes needed');
      return res.json({ ok: true, changed });
    });

    // GET /api/marketing/tasks/history — recent DM tasks with full details (for ChatTrainer UI)
    app.get('/api/marketing/tasks/history', (req, res) => {
      const limit = Math.max(1, Math.min(100, Number(req.query?.limit || 30)));
      const status = String(req.query?.status || '').trim();
      let sql = `SELECT * FROM marketing_tasks WHERE 1=1`;
      const params: any[] = [];
      if (status) { sql += ` AND status = ?`; params.push(status); }
      sql += ` ORDER BY updated_at DESC LIMIT ?`;
      params.push(limit);
      const rows = deepScanDb.prepare(sql).all(...params);
      // Parse conversation_log for display
      const tasks = (rows as any[]).map(t => ({
        ...t,
        conversation_log: (() => { try { return JSON.parse(String(t.conversation_log || '[]')); } catch { return []; } })()
      }));
      return res.json({ ok: true, tasks });
    });

    // POST /api/automation/create-marketing-task — called by bot when follow-back detected
    app.post('/api/automation/create-marketing-task', (req, res) => {
      const { targetHandle, targetName, artistId, botId, category, direction, leadScore, touchCount } = req.body || {};
      if (!targetHandle) return res.status(400).json({ error: 'targetHandle required' });

      const now = Date.now();
      const cat = String(category || 'industry_talk').trim();
      const dir = String(direction || 'tech_discussion').trim();

      // Find best matching script
      let scriptContent = '';
      let scriptId = null;
      try {
        const script = deepScanDb.prepare(`
          SELECT id, content FROM marketing_scripts
          WHERE category = ? AND active = 1
          ORDER BY success_rate DESC, usage_count ASC
          LIMIT 1
        `).get(cat) as any;
        if (script) {
          scriptId = script.id;
          scriptContent = script.content;
          deepScanDb.prepare(`UPDATE marketing_scripts SET usage_count = usage_count + 1 WHERE id = ?`).run(script.id);
        }
      } catch {}

      if (!scriptContent) {
        scriptContent = JSON.stringify({
          category: cat,
          direction: dir,
          generated: true,
          tone: 'professional_friendly',
          template: `Hey @${targetHandle}! We love your work and think our tattoo supplies would be perfect for your shop.`,
        });
      }

      deepScanDb.prepare(`
        INSERT INTO marketing_tasks (target_handle, target_name, artist_id, bot_id, category, direction, script_id, script_content, lead_score, touch_count, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        String(targetHandle), String(targetName || '').slice(0, 200),
        artistId || null, botId || null,
        cat, dir, scriptId, scriptContent,
        Number(leadScore || 0), Number(touchCount || 0),
        now, now
      );

      return res.json({ ok: true, scriptId, category: cat, direction: dir });
    });

    // ========== Behavior Learning Loop — auto-adjust bot profiles ==========

    // POST /api/bot/learn/analyze — analyze one bot's behavior log, compute profile adjustments
    app.post('/api/bot/learn/analyze', (req, res) => {
      const botId = String(req.body?.botId || req.query?.botId || '').trim();
      if (!botId) return res.status(400).json({ error: 'botId required' });

      const now = Date.now();
      const lookbackDays = 7;
      const since = now - lookbackDays * 24 * 60 * 60 * 1000;

      // Step 1: Gather real behavior data from observations & follow actions
      const observations = deepScanDb.prepare(`
        SELECT mode, summary_json, profile_facts_json, created_at
        FROM bot_observations
        WHERE bot_id = ? AND created_at > ?
        ORDER BY created_at ASC
      `).all(botId, since) as Array<{ mode: string; summary_json: string | null; profile_facts_json: string | null; created_at: number }>;

      const followActions = deepScanDb.prepare(`
        SELECT follow_back_detected, followed_at
        FROM ig_follow_actions
        WHERE bot_id = ? AND followed_at > ?
        ORDER BY followed_at ASC
      `).all(botId, since) as Array<{ follow_back_detected: number; followed_at: number }>;

      const marketingTasks = deepScanDb.prepare(`
        SELECT status, category, direction, created_at
        FROM marketing_tasks
        WHERE bot_id = ? AND created_at > ?
        ORDER BY created_at ASC
      `).all(botId, since) as Array<{ status: string; category: string; direction: string; created_at: number }>;

      if (observations.length < 5) {
        return res.json({ ok: true, botId, message: 'insufficient data (need ≥5 observations)', observationsFound: observations.length });
      }

      // Step 2: Compute actual behavior metrics
      const totalTasks = observations.length;
      let totalLikes = 0;
      let totalComments = 0;
      let totalFollows = 0;
      let browseOnlyCount = 0;
      let browseLikeCount = 0;
      const hourlyDistribution: Record<number, number> = {};
      const intervalMsList: number[] = [];

      for (let i = 0; i < observations.length; i++) {
        const obs = observations[i];
        const hour = new Date(Number(obs.created_at)).getHours();
        hourlyDistribution[hour] = (hourlyDistribution[hour] || 0) + 1;

        if (i > 0) {
          intervalMsList.push(Number(obs.created_at) - Number(observations[i - 1].created_at));
        }

        let summary: any = {};
        try { summary = obs.summary_json ? JSON.parse(obs.summary_json) : {}; } catch {}
        const likeSummary = summary?.likeSummary || {};
        totalLikes += Number(likeSummary?.liked || 0);
        totalComments += Number(likeSummary?.commentSummary?.posted || summary?.commentSummary?.posted || 0);
        totalFollows += Number(likeSummary?.followSummary?.followed || summary?.followSummary?.followed || 0);
        if (obs.mode === 'browse_like') browseLikeCount++;
        else browseOnlyCount++;
      }

      const followBackCount = followActions.filter(f => f.follow_back_detected === 1).length;
      const avgIntervalMs = intervalMsList.length > 0 ? intervalMsList.reduce((a, b) => a + b, 0) / intervalMsList.length : 0;
      const avgIntervalMin = Math.round(avgIntervalMs / 60000);

      // Find peak active hours
      const peakHours = Object.entries(hourlyDistribution)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([h]) => `${h}:00`)
        .join(',');

      const avgLikesPerTask = totalTasks > 0 ? +(totalLikes / totalTasks).toFixed(2) : 0;
      const followBackRate = followActions.length > 0 ? +((followBackCount / followActions.length) * 100).toFixed(1) : 0;
      const dmConversion = marketingTasks.length > 0
        ? +((marketingTasks.filter(t => t.status === 'converted').length / marketingTasks.length) * 100).toFixed(1)
        : 0;

      // Step 3: Compare actual vs profile and compute adjustments
      const adjustments: Record<string, any> = {};
      let adjustmentReason: string[] = [];

      // Like strategy adjustment
      if (avgLikesPerTask < 0.5 && browseLikeCount > 0) {
        adjustments['likeStrategy'] = 'sparse';
        adjustmentReason.push(`avg_likes_${avgLikesPerTask}_too_low_→_sparse`);
      } else if (avgLikesPerTask > 3 && browseLikeCount > 5) {
        adjustments['likeStrategy'] = 'generous';
        adjustmentReason.push(`avg_likes_${avgLikesPerTask}_high_→_generous`);
      }

      // Comment style adjustment: if >10% tasks have comments, enable commenting
      const commentRatio = browseLikeCount > 0 ? +(totalComments / browseLikeCount).toFixed(2) : 0;
      if (commentRatio > 0.3) {
        adjustments['commentStyle'] = 'casual_praise';
        adjustmentReason.push(`comment_ratio_${commentRatio}_→_enable_comment`);
      } else if (commentRatio < 0.05 && browseLikeCount > 10) {
        adjustments['commentStyle'] = 'silent';
        adjustmentReason.push(`comment_ratio_${commentRatio}_→_silent`);
      }

      // Follow strategy adjustment based on follow-back rate
      if (followBackRate > 30) {
        adjustments['followStrategy'] = 'selective';
        adjustmentReason.push(`follow_back_${followBackRate}%_high_→_selective`);
      } else if (followBackRate < 5 && followActions.length > 20) {
        adjustments['followStrategy'] = 'aggressive';
        adjustmentReason.push(`follow_back_${followBackRate}%_low_→_aggressive`);
      }

      // Risk profile adjustment based on average interval
      if (avgIntervalMin < 2) {
        adjustments['riskProfile'] = 'cautious';
        adjustmentReason.push(`interval_${avgIntervalMin}min_too_fast_→_cautious`);
      } else if (avgIntervalMin > 20) {
        adjustments['riskProfile'] = 'aggressive';
        adjustmentReason.push(`interval_${avgIntervalMin}min_slow_→_aggressive`);
      }

      // Browse depth adjustment
      const avgOpened = observations.reduce((sum, obs) => {
        try {
          const s = obs.summary_json ? JSON.parse(obs.summary_json) : {};
          return sum + Number(s?.opened || 0);
        } catch { return sum; }
      }, 0) / observations.length;
      if (avgOpened > 5) {
        adjustments['browseDepth'] = 'deep';
        adjustmentReason.push(`avg_opened_${avgOpened.toFixed(1)}_deep_browse`);
      } else if (avgOpened < 1) {
        adjustments['browseDepth'] = 'surface';
        adjustmentReason.push(`avg_opened_${avgOpened.toFixed(1)}_surface_browse`);
      }

      // Active schedule adjustment based on peak hours
      const currentHour = new Date().getHours();
      const morningActive = [6, 7, 8, 9, 10, 11].reduce((s, h) => s + (hourlyDistribution[h] || 0), 0);
      const afternoonActive = [12, 13, 14, 15, 16, 17].reduce((s, h) => s + (hourlyDistribution[h] || 0), 0);
      const eveningActive = [18, 19, 20, 21, 22, 23].reduce((s, h) => s + (hourlyDistribution[h] || 0), 0);
      const nightActive = [0, 1, 2, 3, 4, 5].reduce((s, h) => s + (hourlyDistribution[h] || 0), 0);
      const maxBand = Math.max(morningActive, afternoonActive, eveningActive, nightActive);
      if (maxBand === morningActive) {
        adjustments['activeSchedule'] = 'morning_person';
      } else if (maxBand === nightActive) {
        adjustments['activeSchedule'] = 'night_owl';
      } else if (maxBand === eveningActive) {
        adjustments['activeSchedule'] = 'evening_winder';
      } else {
        adjustments['activeSchedule'] = 'office_hours';
      }

      // Step 4: Store adjustments
      const confidence = Math.min(0.9, +(observations.length / 100).toFixed(2)); // more data = higher confidence
      const analysisResult = {
        observationsAnalyzed: observations.length,
        avgLikesPerTask,
        commentRatio,
        followBackRate,
        avgIntervalMin,
        avgOpened: +avgOpened.toFixed(1),
        peakHours,
        dmConversion,
        hourlyDistribution,
        adjustmentReason,
        totalFollows,
        totalComments
      };

      deepScanDb.prepare(`
        INSERT INTO bot_profile_adjustments (bot_id, adjustments_json, analysis_json, confidence, analyzed_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(bot_id) DO UPDATE SET
          adjustments_json = excluded.adjustments_json,
          analysis_json = excluded.analysis_json,
          confidence = excluded.confidence,
          analyzed_at = excluded.analyzed_at,
          updated_at = excluded.updated_at
      `).run(
        botId,
        JSON.stringify(adjustments),
        JSON.stringify(analysisResult),
        confidence,
        now, now, now
      );

      return res.json({
        ok: true,
        botId,
        observationsAnalyzed: observations.length,
        adjustments,
        confidence,
        analysis: analysisResult
      });
    });

    // GET /api/bot/profile/{botId} — get merged profile (base + adjustments)
    app.get('/api/bot/profile/:botId', (req, res) => {
      const botId = String(req.params?.botId || '').trim();
      if (!botId) return res.status(400).json({ error: 'botId required' });

      // Get base profile from the profile module
      const baseProfile = getBotProfile(botId);

      // Get adjustments if any
      const adjustment = deepScanDb.prepare(`
        SELECT adjustments_json, confidence, analyzed_at FROM bot_profile_adjustments WHERE bot_id = ?
      `).get(botId) as { adjustments_json: string; confidence: number; analyzed_at: number } | undefined;

      let adjustments: Record<string, any> = {};
      if (adjustment) {
        try { adjustments = JSON.parse(adjustment.adjustments_json); } catch {}
      }

      // Build merged profile (base + overrides)
      const merged = {
        ...baseProfile,
        _meta: {
          base: botId,
          adjusted: Object.keys(adjustments).length > 0,
          adjustments,
          confidence: adjustment?.confidence || 0,
          analyzedAt: adjustment?.analyzed_at ? new Date(Number(adjustment.analyzed_at)).toISOString() : null,
        },
        strategies: {
          ...baseProfile.strategies,
          ...adjustments
        }
      };

      // Re-derive numeric configs from adjusted strategies
      const { LIKE_CONFIG, COMMENT_CONFIG, FOLLOW_CONFIG, BROWSE_CONFIG, RISK_CONFIG, MARKETING_CONFIG } = require('./bot-profile.ts') || {};
      // Dynamic import doesn't work in require, so we compute inline
      // (the client-side code reads strategies directly from the merged profile)

      return res.json({ ok: true, profile: merged });
    });

    // GET /api/bot/learn/status — global learning dashboard data
    app.get('/api/bot/learn/status', (_req, res) => {
      const bots = deepScanDb.prepare(`
        SELECT bot_id, adjustments_json, analysis_json, confidence, analyzed_at, updated_at
        FROM bot_profile_adjustments
        ORDER BY updated_at DESC
      `).all() as Array<{ bot_id: string; adjustments_json: string; analysis_json: string; confidence: number; analyzed_at: number; updated_at: number }>;

      const profiles = bots.map(b => {
        let adjustments: Record<string, any> = {};
        let analysis: Record<string, any> = {};
        try { adjustments = JSON.parse(b.adjustments_json); } catch {}
        try { analysis = JSON.parse(b.analysis_json); } catch {}
        return {
          botId: b.bot_id,
          adjustments,
          analysis,
          confidence: b.confidence,
          analyzedAt: new Date(Number(b.analyzed_at)).toISOString(),
          updatedAt: new Date(Number(b.updated_at)).toISOString()
        };
      });

      return res.json({ ok: true, total: bots.length, profiles });
    });

    // ========== Daily Bot Stats & Dashboard API ==========

    // POST /api/bot/stats/record — bot records daily stats (called during heartbeat or on task complete)
    app.post('/api/bot/stats/record', (req, res) => {
      if (!requireBotAuth(req, res)) return;
      const { botId, likes, comments, follows } = req.body || {};
      if (!botId) return res.status(400).json({ error: 'botId required' });
      const today = new Date().toISOString().slice(0, 10);
      const now = Date.now();

      // Upsert daily stats row
      deepScanDb.prepare(`
        INSERT INTO daily_bot_stats (bot_id, date, likes_given, comments_given, follows_done, actions_by_hour, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(bot_id, date) DO UPDATE SET
          likes_given = likes_given + excluded.likes_given,
          comments_given = comments_given + excluded.comments_given,
          follows_done = follows_done + excluded.follows_done,
          updated_at = excluded.updated_at
      `).run(
        String(botId), today,
        Number(likes || 0), Number(comments || 0), Number(follows || 0),
        JSON.stringify({}), now, now
      );

      return res.json({ ok: true, date: today });
    });

    // GET /api/bot/stats/dashboard — aggregated dashboard data
    app.get('/api/bot/stats/dashboard', (req, res) => {
      const days = Math.max(1, Math.min(90, Number(req.query?.days || 14)));
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      // Daily aggregates across all bots
      const dailyRows = deepScanDb.prepare(`
        SELECT date,
               SUM(likes_given) AS total_likes,
               SUM(comments_given) AS total_comments,
               SUM(follows_done) AS total_follows,
               SUM(dms_sent) AS total_dms_sent,
               SUM(dms_replied) AS total_dms_replied,
               SUM(dms_converted) AS total_dms_converted,
               SUM(comments_received) AS total_comments_received,
               SUM(comments_replied) AS total_comments_replied,
               SUM(followers_gained) AS total_followers_gained,
               SUM(followers_lost) AS total_followers_lost,
               SUM(unfollows_done) AS total_unfollows
        FROM daily_bot_stats
        WHERE date >= ?
        GROUP BY date
        ORDER BY date ASC
      `).all(since) as Array<Record<string, any>>;

      // Per-bot summary
      const botRows = deepScanDb.prepare(`
        SELECT bot_id,
               SUM(likes_given) AS total_likes,
               SUM(comments_given) AS total_comments,
               SUM(follows_done) AS total_follows,
               SUM(dms_sent) AS total_dms_sent,
               SUM(dms_converted) AS total_dms_converted,
               SUM(followers_gained) AS total_followers_gained
        FROM daily_bot_stats
        WHERE date >= ?
        GROUP BY bot_id
      `).all(since);

      // Traffic light indicators
      const today = new Date().toISOString().slice(0, 10);
      const todayStats = dailyRows.find((r: any) => r.date === today);
      const yesterdayStats = dailyRows.find((r: any) => r.date === new Date(Date.now() - 86400000).toISOString().slice(0, 10));

      // DM conversion funnel
      const totalDmsSent = dailyRows.reduce((s, r) => s + Number(r.total_dms_sent || 0), 0);
      const totalDmsReplied = dailyRows.reduce((s, r) => s + Number(r.total_dms_replied || 0), 0);
      const totalDmsConverted = dailyRows.reduce((s, r) => s + Number(r.total_dms_converted || 0), 0);

      // Online bots
      const onlineBots = deepScanDb.prepare(`
        SELECT COUNT(*) AS cnt FROM bot_instances WHERE status IN ('online','paused')
      `).get() as { cnt: number };

      // Task stats
      const taskCounts = deepScanDb.prepare(`
        SELECT status, COUNT(*) AS cnt FROM automation_tasks GROUP BY status
      `).all() as Array<{ status: string; cnt: number }>;

      return res.json({
        ok: true,
        daily: dailyRows.map((r: any) => ({
          date: r.date,
          likes: Number(r.total_likes || 0),
          comments: Number(r.total_comments || 0),
          follows: Number(r.total_follows || 0),
          dmsSent: Number(r.total_dms_sent || 0),
          dmsReplied: Number(r.total_dms_replied || 0),
          dmsConverted: Number(r.total_dms_converted || 0),
          commentsReceived: Number(r.total_comments_received || 0),
          commentsReplied: Number(r.total_comments_replied || 0),
          followersGained: Number(r.total_followers_gained || 0),
          followersLost: Number(r.total_followers_lost || 0),
          unfollows: Number(r.total_unfollows || 0)
        })),
        bots: botRows.map((r: any) => ({
          botId: r.bot_id,
          likes: Number(r.total_likes || 0),
          comments: Number(r.total_comments || 0),
          follows: Number(r.total_follows || 0),
          dmsSent: Number(r.total_dms_sent || 0),
          dmsConverted: Number(r.total_dms_converted || 0),
          followersGained: Number(r.total_followers_gained || 0)
        })),
        funnel: {
          dmsSent: totalDmsSent,
          dmsReplied: totalDmsReplied,
          dmsConverted: totalDmsConverted,
          replyRate: totalDmsSent > 0 ? Math.round((totalDmsReplied / totalDmsSent) * 100) : 0,
          conversionRate: totalDmsSent > 0 ? Math.round((totalDmsConverted / totalDmsSent) * 100) : 0
        },
        online: Number(onlineBots?.cnt || 0),
        tasks: Object.fromEntries(taskCounts.map((t: any) => [t.status, Number(t.cnt || 0)]))
      });
    });

    // ========== Inbound Engagement Tracking: people who follow/like/comment our account ==========

    // POST /api/bot/inbound-engagement — report external user engaging with our account
    app.post('/api/bot/inbound-engagement', async (req, res) => {
      if (!requireBotAuth(req, res)) return;
      const { handle, engagementType, postUrl } = req.body || {};
      const userHandle = String(handle || '').replace(/^@/, '').trim().toLowerCase();
      const type = String(engagementType || 'follow').trim(); // 'follow' | 'like' | 'comment'
      if (!userHandle) return res.status(400).json({ error: 'handle required' });

      const now = Date.now();
      const today = new Date().toISOString().slice(0, 10);

      // Log to bot_observations as a special mode
      deepScanDb.prepare(`
        INSERT INTO bot_observations (bot_id, artist_handle, mode, summary_json, created_at)
        VALUES (?, ?, 'inbound_engagement', ?, ?)
      `).run(
        String(req.body?.botId || 'unknown'), userHandle,
        JSON.stringify({ engagementType: type, postUrl: postUrl || '', source: 'inbound' }),
        now
      );

      // Update CRM stage via Neon if the artist exists
      try {
        // Map engagement type to stage
        const stageMap: Record<string, string> = {
          'follow': 'warm',
          'like': 'warm',
          'comment': 'engaged'
        };
        const newStage = stageMap[type] || 'warm';

        // Try to find by ig_handle
        const matched = await sql`
          SELECT id, stage FROM artists
          WHERE ig_handle ILIKE ${'%' + userHandle + '%'}
          LIMIT 1
        `;
        const artist = (matched as any[])?.[0];
        if (artist) {
          const currentStage = String(artist.stage || 'lead').toLowerCase();
          const stageRank: Record<string, number> = { lead: 0, cold: 1, warm: 2, engaged: 3, connected: 4, customer: 5 };
          const currentRank = stageRank[currentStage] ?? 0;
          const newRank = stageRank[newStage] ?? 0;
          // Only upgrade, never downgrade
          if (newRank > currentRank) {
            await sql`
              UPDATE artists SET stage = ${newStage}, last_updated = NOW()
              WHERE id = ${artist.id}
            `;
          }
        }
        // If not found in CRM, it's an organic follower not yet in our system — that's fine
      } catch {}

      // Update daily_bot_stats engagement counter
      deepScanDb.prepare(`
        INSERT INTO daily_bot_stats (bot_id, date, comments_received, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(bot_id, date) DO UPDATE SET
          comments_received = comments_received + 1,
          updated_at = excluded.updated_at
      `).run(String(req.body?.botId || 'unknown'), today, now, now);

      return res.json({ ok: true, handle: userHandle, stage: 'updated' });
    });

    // ========== Content Pipeline: customer content → publish ==========
    // Sources: converted customers who follow-backed + used our products + posted about them

    // POST /api/content/pipeline/generate — generate publish tasks from customer content
    app.post('/api/content/pipeline/generate', async (req, res) => {
      const limit = Math.max(1, Math.min(20, Number(req.body?.limit || 5)));

      // Step 1: Get handles of converted customers (followed back + bought)
      const convertedHandles = deepScanDb.prepare(`
        SELECT DISTINCT target_handle FROM marketing_tasks WHERE status = 'converted'
        UNION
        SELECT DISTINCT target_handle FROM marketing_tasks WHERE status = 'replied'
      `).all() as Array<{ target_handle: string }>;

      const customerHandles = convertedHandles.map(r => String(r.target_handle || '').trim().toLowerCase()).filter(Boolean);

      if (customerHandles.length === 0) {
        return res.json({ ok: true, generated: 0, message: 'No converted customers yet — need follow-back + purchase first' });
      }

      // Step 2: Find content_samples from these customers (they posted about our products)
      const placeholders = customerHandles.map(() => 'LOWER(handle) LIKE ?');
      const queryParams = customerHandles.map(h => `%${h}%`);
      const samples = deepScanDb.prepare(`
        SELECT * FROM content_samples
        WHERE (${placeholders.join(' OR ')})
          AND caption IS NOT NULL AND caption != ''
        ORDER BY quality_score DESC, engagement_hint DESC
        LIMIT ?
      `).all(...queryParams, limit) as Array<Record<string, any>>;

      if (samples.length === 0) {
        return res.json({ ok: true, generated: 0, message: `Found ${customerHandles.length} customers but no content samples from them yet. Bots will collect their posts on next visit.` });
      }

      const now = Date.now();
      const results: any[] = [];
      const existingTasks = new Set(
        (deepScanDb.prepare(`SELECT content_id FROM content_publish_tasks WHERE status IN ('pending','scheduled')`)
          .all() as Array<{ content_id: string }>).map(r => r.content_id)
      );

      for (const sample of samples) {
        const contentId = `customer_${sample.id}`;
        if (existingTasks.has(contentId)) continue;

        const caption = String(sample.caption || '').trim();
        if (!caption || caption.length < 10) continue;

        const postUrl = String(sample.post_url || '');
        const handle = String(sample.handle || 'unknown');
        const styleTags = (() => { try { return JSON.parse(String(sample.style_tags_json || '[]')); } catch { return []; } })();

        // Schedule spread out over next 7 days
        const dayOffset = results.length * 1.5; // 1.5 days between posts
        const scheduleAt = now + Math.floor(dayOffset * 86400000) + 3600000 + Math.floor(Math.random() * 43200000);

        const payload = JSON.stringify({
          source: 'customer_content',
          customerHandle: handle,
          originalPostUrl: postUrl,
          originalCaption: caption,
          caption, // use as-is or let publish-worker rewrite
          topic: String(sample.topic_tag || 'product_showcase'),
          cta: String(sample.cta_tag || 'shop_now'),
          sampleId: sample.id,
          qualityScore: sample.quality_score,
          styleTags,
          // publish-worker will use this as reference material
          isCustomerUgc: true
        });

        try {
          deepScanDb.prepare(`
            INSERT INTO content_publish_tasks (id, platform, bot_id, payload, status, scheduled_at, created_at, updated_at)
            VALUES (?, 'instagram', NULL, ?, 'pending', ?, ?, ?)
          `).run(contentId, payload, scheduleAt, now, now);
          results.push({ contentId, customerHandle: handle, caption: caption.slice(0, 80), scheduleAt });
        } catch { /* duplicate */ }
      }

      return res.json({
        ok: true,
        generated: results.length,
        customerCount: customerHandles.length,
        tasks: results
      });
    });

    // GET /api/content/pipeline/queue — list pending/scheduled publish tasks
    app.get('/api/content/pipeline/queue', (req, res) => {
      const rows = deepScanDb.prepare(`
        SELECT id, platform, payload, status, scheduled_at, created_at
        FROM content_publish_tasks
        WHERE status IN ('pending','scheduled','pending_media')
        ORDER BY scheduled_at ASC
        LIMIT 50
      `).all() as Array<Record<string, any>>;

      const tasks = rows.map(r => ({
        id: r.id,
        platform: r.platform,
        status: r.status,
        scheduledAt: r.scheduled_at,
        createdAt: r.created_at,
        caption: (() => {
          try {
            const p = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload;
            return String(p.caption || '').slice(0, 100);
          } catch { return ''; }
        })()
      }));

      return res.json({ ok: true, total: tasks.length, tasks });
    });

    // GET /api/content/pipeline/bot-queue?limit=N&status=pending&botId=X — bot worker endpoint
    app.get('/api/content/pipeline/bot-queue', (req, res) => {
      const limit = Math.max(1, Math.min(5, Number(req.query.limit) || 1));
      const status = String(req.query.status || 'pending');
      const botId = String(req.query.botId || '');

      let where = `status = '${status}'`;
      if (botId) where += ` AND bot_id = '${botId.replace(/'/g, "''")}'`;

      const rows = deepScanDb.prepare(`
        SELECT id, platform, payload, status, scheduled_at, created_at, updated_at
        FROM content_publish_tasks
        WHERE ${where}
        ORDER BY scheduled_at ASC
        LIMIT ?
      `).all(limit) as Array<Record<string, any>>;

      const tasks = rows.map(r => ({
        id: r.id,
        platform: r.platform,
        status: r.status,
        scheduledAt: r.scheduled_at,
        createdAt: r.created_at,
        payload: r.payload,
      }));

      return res.json({ ok: true, total: tasks.length, tasks });
    });

    // POST /api/content/pipeline/claim — bot claims a task
    app.post('/api/content/pipeline/claim', (req, res) => {
      const { taskId, botId } = req.body || {};
      if (!taskId || !botId) return res.status(400).json({ ok: false, error: 'taskId and botId required' });

      const now = Date.now();
      const updated = deepScanDb.prepare(`
        UPDATE content_publish_tasks
        SET status = 'processing', updated_at = ?, leased_by = ?, lease_until = ?, bot_id = ?
        WHERE id = ? AND status = 'pending'
      `).run(now, botId, now + 300_000, botId, taskId);

      if (updated.changes > 0) {
        return res.json({ ok: true, taskId });
      }
      return res.json({ ok: false, error: 'task not in pending state or already claimed' });
    });

    // POST /api/content/pipeline/result — report publish result
    app.post('/api/content/pipeline/result', (req, res) => {
      const { taskId, status, postUrl, errorReason, botId } = req.body || {};
      if (!taskId || !status) return res.status(400).json({ ok: false, error: 'taskId and status required' });

      const now = Date.now();
      deepScanDb.prepare(`
        UPDATE content_publish_tasks
        SET status = ?, published_at = ?, platform_post_id = ?, error_reason = ?, updated_at = ?
        WHERE id = ?
      `).run(status, status === 'done' ? now : null, postUrl || null, errorReason || null, now, taskId);

      return res.json({ ok: true, taskId, status });
    });

    // GET /api/content/pipeline/count-today — count published today for a bot
    app.get('/api/content/pipeline/count-today', (req, res) => {
      const botId = String(req.query.botId || '');
      const dayStart = Number(req.query.dayStart || 0);

      if (!botId) return res.status(400).json({ ok: false, error: 'botId required' });

      let where = "status = 'done' AND published_at IS NOT NULL";
      if (dayStart > 0) {
        where += ` AND published_at >= ${dayStart}`;
      }
      if (botId) {
        where += ` AND bot_id = '${botId.replace(/'/g, "''")}'`;
      }

      const row = deepScanDb.prepare(`SELECT COUNT(*) as count FROM content_publish_tasks WHERE ${where}`).get() as any;
      return res.json({ ok: true, count: row?.count || 0 });
    });

    const BOT_FUNCTIONS = [
      {
        id: 'supply_comments',
        name: 'Supply Comments Bot',
        description: 'Scrapes tattoo supply brand comments on artist posts → builds dataset → generates brand-voice replies. CDP Chrome, trained on real brand comment samples.',
        script: 'bot-comments-scraper.ts',
        defaultBotId: 'bot_comments_01',
        execMode: 'browse_only',
        taskType: 'supply_comments',
        browserMode: 'cdp',
        multiAccount: false,
        workflow: 'CDP 连桌面 2 Chrome 共享 IG 登录态 → 遍历热门纹身师帖子 → 提取评论区品牌账号回复 → 按分类入库（compliment/product_mention/feature_request/artist_appreciation/educational/technique_question/emoji_only/short_reaction）→ 分类统计品牌回复策略 → 数据集用于训练 supply-comment-generator 以品牌口吻自动回复纹身师作品',
        businessValue: ['品牌回复策略学习', 'comments 话术库积累', 'supply comment bot 训练数据', '竞品品牌互动策略分析'],
        outputs: ['品牌评论数据集（按分类）', '品牌回复策略统计', '品牌话术风格分析'],
        useCases: ['采集 FK Irons/Cheyenne 等品牌在纹身师作品下的评论', '学习品牌回复纹身师的话术风格', '训练 supply comment bot 自动以品牌口吻回复'],
        configs: [
          { key: 'BOT_CDP_URL', label: 'CDP URL', type: 'text', default: 'http://localhost:9222' },
        ]
      },
      {
        id: 'ig_outreach',
        name: 'IG Outreach bot',
        description: 'Auto browse, like, comment, follow tattoo shops on Instagram. Supports 10-20+ accounts, each with its own browser profile and proxy.',
        script: 'bot-outreach.ts',
        defaultBotId: 'bot_outreach_01',
        execMode: 'browse_like',
        taskType: 'ig_outreach',
        browserMode: 'cdp',
        multiAccount: true,
        workflow: 'Playwright Chromium persistent profile 打开 IG → 轮询 tasks 表获取目标账号 → 访问主页采集画像：粉丝数/关注数/帖子数、IG 分类标签（Tattoo Shop/Piercing 等）、邮箱、地址、外链、帖子样本描述、图片 alt 信号、纹身风格关键词命中 → AI 信号评分 + 非纹身嫌疑过滤 → 执行互动（浏览帖子 → like/comment/follow，带真人行为模拟和冷却控制）→ 追踪回访次数和互动频率 → 产出 lead 评分/优先级/热度分 → 结果回传 CRM 更新 lead 状态',
        businessValue: ['社媒曝光涨粉', '精准触达获取 leads', '批量互动养号', 'CRM 数据填充', '粉丝/竞品画像采集', '非纹身自动过滤'],
        outputs: ['CRM leads（含粉丝数/帖子数/分类/邮箱/地址/风格标签）', '互动记录（like/comment/follow + 冷却时间）', 'lead 评分和热度分', '账号成长指标', '目标客户画像（含风格偏好/商业属性）'],
        useCases: ['IG 账号矩阵涨粉', '品牌精准曝光', '潜在客户触达转化', 'CRM 冷启动数据采集', '纹身店铺画像数据库', '市场区域覆盖分析'],
        configs: [
          { key: 'BOT_EXEC_MODE', label: '执行模式', type: 'select', options: ['browse_like', 'browse_only'], default: 'browse_like' },
          { key: 'BOT_CDP_URL', label: 'CDP URL', type: 'text', default: 'http://localhost:9222' },
          { key: 'BOT_SPEED_FACTOR', label: '速度系数', type: 'number', default: 1.0, min: 0.5, max: 5, step: 0.1 },
        ]
      },
      {
        id: 'supply_analysis',
        name: 'Supply Analysis bot',
        description: 'Analyze competitor supply brands + competitors on Instagram. Connects via CDP to Desktop 2 Chrome, DeepSeek generates product intelligence.',
        script: 'bot-supply.ts',
        defaultBotId: 'bot_supply_01',
        execMode: 'browse_only',
        taskType: 'supply_analysis',
        browserMode: 'cdp',
        multiAccount: false,
        workflow: 'CDP 连桌面 2 Chrome 共享 IG 登录态 → 长期持续追踪竞品品牌在所有渠道的新品发布内容：IG 主页爬取（粉丝/发帖/bio/商业标记）→ 网格逐条采集所有可见帖子 → 模态框提取帖文类型/风格/hashtag/产品信号词/发布时间/互动数 → 评论抓取 + AI 情感分析 → 多角度 Web 搜索外部情报（Reddit/电商/新闻/官网）→ DeepSeek 综合分析找出新品发布逻辑和模式：产品矩阵/定价策略/发布节奏/内容结构/互动规律/竞争差异 → 长期积累多轮数据，追踪品牌的产品线扩张路径和新品迭代规律，生成可复用的发布策略模型',
        businessValue: ['竞品长期追踪', '跨渠道新品发现', '发布策略逆向工程', '产品矩阵演变分析', '社媒内容策略规划', '市场调研与定位'],
        outputs: ['竞品产品矩阵（名称/品类/定价/目标客群/迭代历史）', '多轮追踪产品变更日志', '发布策略模型（teaser→reveal→demo→availability→sustain 全链路）', '跨渠道发布规律总结', 'hashtag 策略演变', '互动趋势分析', '竞争差异定位报告'],
        useCases: ['竞品新品发布即时发现', '竞品产品线扩张路径追踪', '发布策略逆向工程（拆解竞品打法）', '内容差异化策略制定', '品牌定位调整', '社媒内容日历规划', '新品开发方向参考'],
        configs: [
          { key: 'BOT_EXEC_MODE', label: '执行模式', type: 'select', options: ['browse_only', 'browse_like'], default: 'browse_only' },
          { key: 'BOT_CDP_URL', label: 'CDP URL', type: 'text', default: 'http://localhost:9222' },
        ]
      },
      {
        id: 'reddit_intel',
        name: 'Reddit Intel bot',
        description: 'Scrape tattoo subreddits, AI classify discussions for brand/product insights, route intel to DB.',
        script: 'bot-reddit.ts',
        defaultBotId: 'bot_reddit_01',
        execMode: 'browse_only',
        taskType: 'reddit_scrape',
        browserMode: 'none',
        multiAccount: false,
        workflow: 'HTTP 爬取 tattoo 相关 subreddits → AI 多维度分类：品牌/产品讨论、纹身技术（手法/风格/技巧）、工具设备（机器/针/色料/护理品）、行业趋势、用户问题 → 提取竞品品牌提及 + 本品牌口碑 → 挖掘技术趋势/工具评测/用户痛点/客服需求 → 入库 intel 表供产品研发和内容策略用',
        businessValue: ['竞品品牌内容挖掘', '本品牌口碑监控', '纹身技术趋势跟踪', '工具/设备市场情报', '新品研发线索', '用户痛点挖掘', '客服素材库'],
        outputs: ['竞品品牌提及报告', '本品牌口碑分析', '纹身技术趋势报告', '工具/设备评测汇总', '产品需求清单', '用户痛点分析', '客服话术素材', '行业讨论趋势'],
        useCases: ['新品开发方向研究（机器/色料/护理品/耗材）', '老品改造升级', '纹身技术趋势跟踪', '工具采购决策参考', '客服话术优化', '内容素材灵感', '品牌口碑维护'],
        configs: [
          { key: 'REDDIT_SUBREDDITS', label: 'Subreddits', type: 'text', default: 'tattoo,tattoos,tattooartists' },
          { key: 'REDDIT_POSTS_PER_SUB', label: '每版帖子数', type: 'number', default: 15, min: 5, max: 50 },
        ]
      },
      {
        id: 'content_pipeline',
        name: 'Content Pipeline bot',
        description: 'Full pipeline: scrape partner content → AI vision scoring → DeepSeek rewrite → auto-publish to IG.',
        script: 'pipeline-orchestrator.ts',
        defaultBotId: null,
        execMode: null,
        taskType: null,
        browserMode: 'none',
        multiAccount: false,
        workflow: 'scrape (抓取合作方/竞品 IG 内容 或 AI 生图) → AI vision scoring 筛选高质量素材 → DeepSeek 改写文案适配品牌风格 → 生成图文/视频帖 → auto-publish 到绑定的 N 个 IG 号矩阵发帖吸粉',
        businessValue: ['内容自动化生成', '矩阵号运营', '品牌素材库积累', 'AI 视觉素材生产'],
        outputs: ['改写后帖文', 'AI 生成图片/视频', '发布计划排期', '品牌内容库'],
        useCases: ['矩阵号日更自动化', '品牌内容库沉淀', '多账号内容分发', 'AI 视觉素材生产'],
        configs: [
          { key: 'CONTENT_MODE', label: 'Pipeline Mode', type: 'select', options: ['scrape', 'create', 'publish', 'full'], default: 'full' },
        ]
      },
      {
        id: 'forum_monitor',
        name: 'Forum Monitor bot',
        description: 'Monitor tattoo forums (LastSparrow, ReinventingTheTattoo, TattooNow) for brand mentions, product discussions, and sentiment analysis.',
        script: 'forum-monitor.ts',
        defaultBotId: null,
        execMode: null,
        taskType: null,
        browserMode: 'playwright',
        multiAccount: false,
        workflow: 'Playwright 渲染 XenForo/vBulletin 论坛（ReinventingTheTattoo/LastSparrowTattoo/TattooNow）→ 提取新帖/新回复 → AI 分类 (品牌/产品/机器/色料/技术/护理/行业) → 提取纹身师讨论热点/工具推荐/品牌反馈 → 入库 intel 表，与 Reddit Intel 互补覆盖论坛渠道',
        businessValue: ['论坛情报收集', '品牌口碑监控', '纹身技术/工具讨论挖掘', '行业趋势跟踪'],
        outputs: ['论坛情报数据', '品牌提及报告', '纹身师工具偏好', '行业讨论趋势'],
        useCases: ['品牌口碑监控', '行业动态跟踪', '纹身师需求洞察', '竞品论坛活动', 'Reddit Intel 渠道互补'],
        configs: [
          { key: 'FORUM_SOURCES', label: 'Sources', type: 'text', default: 'reinventingtattoo,lastsparrowtattoo,tattoonow' },
        ]
      },
      {
        id: 'product_tracker',
        name: 'Product Tracker bot',
        description: 'AI product detection from competitor mentions, IG profile analysis, social heat scoring (0-100), status change detection.',
        script: 'product-tracker.ts',
        defaultBotId: null,
        execMode: null,
        taskType: null,
        browserMode: 'none',
        multiAccount: false,
        workflow: '聚合 Supply Analysis + Reddit Intel + Forum Monitor 多源数据 → DeepSeek 检测新品发布/下架/改版/扩张 → 覆盖产品类型：纹身机器/笔、色料品牌、护理产品、耗材配件 → 社交热度评分 (0-100) → 更新 competitor_products 表 → 推送变更提醒',
        businessValue: ['新品发布追踪', '竞品扩张路径分析', '市场空白识别', '产品生命周期监控'],
        outputs: ['新品发现列表（按品类分类）', '产品变更日志', '竞品扩张路径图', '社交热力评分', '市场空白报告'],
        useCases: ['及时发现竞品新品（机器/色料/护理）', '追踪竞品产品线扩张路径', '市场空白机会识别', '产品组合优化决策', '老品淘汰预警'],
        configs: []
      },
    ];

    const runningBots: Record<string, { botId: string; pid: number; startedAt: number; functionId: string; env: Record<string, string> }> = {};

    app.get('/api/bot/functions', (_req, res) => {
      res.json({ functions: BOT_FUNCTIONS });
    });

    app.get('/api/bot/workers', (req, res) => {
      const workers = Object.values(runningBots).map(b => ({
        botId: b.botId,
        functionId: b.functionId,
        pid: b.pid,
        startedAt: b.startedAt,
        running: true,
        env: b.env,
      }));
      // Also include registered-but-not-managed-by-this-server bots from DB
      res.json({ workers });
    });

    app.post('/api/bot/worker/start', (req, res) => {
      try {
        const functionId = String(req.body?.functionId || '').trim();
        const fn = BOT_FUNCTIONS.find(f => f.id === functionId);
        if (!fn) return res.status(400).json({ error: `Unknown function: ${functionId}` });

        const botId = String(req.body?.botId || fn.defaultBotId || `bot_${functionId}_${Date.now()}`).trim();
        const customEnv: Record<string, string> = req.body?.env || {};

        // Check if already running
        const existing = Object.values(runningBots).find(b => b.botId === botId);
        if (existing) {
          return res.status(409).json({ error: `Bot ${botId} is already running`, startedAt: existing.startedAt });
        }

        const isWin = process.platform === 'win32';
        const env: Record<string, string> = {
          ...Object.fromEntries(Object.entries(process.env).map(([k, v]) => [k, String(v || '')])),
          BOT_ID: botId,
          BOT_API_KEY: process.env.BOT_API_KEY || 'inkflow_bot_key_2026',
          ...customEnv,
        };

        if (fn.taskType) env['BOT_TASK_TYPE'] = fn.taskType;
        if (fn.execMode) env['BOT_EXEC_MODE'] = fn.execMode;

        const child = spawn(
          isWin ? 'cmd' : 'npx',
          isWin ? ['/c', 'npx', 'tsx', `scripts/${fn.script}`] : ['tsx', `scripts/${fn.script}`],
          { cwd: process.cwd(), stdio: 'pipe', env }
        );

        const pid = child.pid as number;
        runningBots[botId] = { botId, pid, startedAt: Date.now(), functionId, env };

        child.stdout?.on('data', (d: Buffer) => {
          const ts = new Date().toISOString().slice(11, 19);
          for (const line of d.toString().split('\n').filter(Boolean)) {
            console.log(`[bot:${botId}] ${line}`);
          }
        });
        child.stderr?.on('data', (d: Buffer) => {
          const ts = new Date().toISOString().slice(11, 19);
          for (const line of d.toString().split('\n').filter(Boolean)) {
            console.error(`[bot:${botId}:err] ${line}`);
          }
        });
        child.on('close', (code) => {
          delete runningBots[botId];
          console.log(`[bot:${botId}] exited (code ${code})`);
        });

        return res.json({ ok: true, botId, pid, functionId, startedAt: runningBots[botId].startedAt });
      } catch (e: any) {
        return res.status(500).json({ error: String(e?.message || e) });
      }
    });

    app.post('/api/bot/worker/stop/:botId', (req, res) => {
      const botId = String(req.params?.botId || '').trim();
      const entry = runningBots[botId];
      if (!entry) return res.status(404).json({ error: `Bot ${botId} not found or not running` });

      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/PID', String(entry.pid), '/T', '/F']);
        } else {
          process.kill(entry.pid, 'SIGTERM');
        }
        delete runningBots[botId];
        return res.json({ ok: true, botId, stopped: true });
      } catch (e: any) {
        return res.status(500).json({ error: String(e?.message || e) });
      }
    });

    app.get('/api/bot/coverage', async (req, res) => {
      try {
        const state = String(req.query?.state || '').trim();
        const whereState = state ? sql`AND import_region ILIKE ${state}` : sql``;
        const rows = await sql`
          SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE ig_handle IS NOT NULL AND ig_handle <> '' AND ig_handle <> 'N/A')::int AS with_ig,
            COUNT(*) FILTER (WHERE email IS NOT NULL AND email <> '' AND email <> 'N/A')::int AS with_email,
            COUNT(*) FILTER (WHERE facebook IS NOT NULL AND facebook <> '' AND facebook <> 'N/A')::int AS with_facebook,
            COUNT(*) FILTER (WHERE website IS NOT NULL AND website <> '' AND website <> 'N/A')::int AS with_website
          FROM artists
          WHERE 1=1
          ${whereState}
        `;
        const x: any = rows?.[0] || { total: 0, with_ig: 0, with_email: 0, with_facebook: 0, with_website: 0 };
        return res.json({
          state: state || 'ALL',
          total: Number(x.total || 0),
          withIg: Number(x.with_ig || 0),
          withEmail: Number(x.with_email || 0),
          withFacebook: Number(x.with_facebook || 0),
          withWebsite: Number(x.with_website || 0)
        });
      } catch (e: any) {
        return res.status(500).json({ error: 'bot_coverage_failed', details: e?.message || String(e) });
      }
    });

    app.get('/api/bot/schedule', (req, res) => {
      const config = loadBotScheduleConfig();
      const state = loadBotScheduleState();
      return res.json({ config, state });
    });

    app.post('/api/bot/schedule', (req, res) => {
      const body = req.body || {};
      const prev = loadBotScheduleConfig();
      const next: BotScheduleConfig = {
        enabled: body?.enabled === true,
        pauseWindow: {
          start: String(body?.pauseWindow?.start || prev.pauseWindow.start),
          end: String(body?.pauseWindow?.end || prev.pauseWindow.end)
        },
        resumeWindow: {
          start: String(body?.resumeWindow?.start || prev.resumeWindow.start),
          end: String(body?.resumeWindow?.end || prev.resumeWindow.end)
        },
        resumeBotIds: Array.isArray(body?.resumeBotIds)
          ? body.resumeBotIds.map((x: any) => String(x || '').trim()).filter(Boolean)
          : prev.resumeBotIds
      };
      saveBotScheduleConfig(next);
      // Force regenerate today's random plan on next tick.
      deepScanDb.prepare(`DELETE FROM bot_schedule WHERE id = 'state'`).run();
      return res.json({ ok: true, config: next });
    });

    app.post('/api/bot/schedule/trigger/pause-now', (req, res) => {
      try {
        const paused = pauseAllBotsInternal();
        return res.json({ ok: true, paused, ts: Date.now() });
      } catch (e: any) {
        return res.status(500).json({ error: 'trigger_pause_now_failed', details: e?.message || String(e) });
      }
    });

    app.post('/api/bot/schedule/trigger/resume-now', (req, res) => {
      try {
        const cfg = loadBotScheduleConfig();
        const resumed = resumeBotsInternal(cfg.resumeBotIds);
        return res.json({ ok: true, resumed, resumeBotIds: cfg.resumeBotIds, ts: Date.now() });
      } catch (e: any) {
        return res.status(500).json({ error: 'trigger_resume_now_failed', details: e?.message || String(e) });
      }
    });

    app.post('/api/bot/schedule/trigger/regenerate-today', (req, res) => {
      try {
        deepScanDb.prepare(`DELETE FROM bot_schedule WHERE id = 'state'`).run();
        runBotScheduleTick();
        const state = loadBotScheduleState();
        return res.json({ ok: true, state });
      } catch (e: any) {
        return res.status(500).json({ error: 'trigger_regenerate_today_failed', details: e?.message || String(e) });
      }
    });

    app.post('/api/content/competitors/import-handles', (req, res) => {
      try {
        const handlesRaw = Array.isArray(req.body?.handles) ? req.body.handles : [];
        const source = String(req.body?.source || 'manual').trim();
        const now = Date.now();
        const normalizeHandle = (x: any) => String(x || '').trim().replace(/^@/, '').toLowerCase();
        const handles = Array.from(new Set(handlesRaw.map(normalizeHandle).filter(Boolean))).slice(0, 500);
        if (!handles.length) return res.status(400).json({ error: 'No handles provided' });
        const stmt = deepScanDb.prepare(`
          INSERT INTO content_competitors (handle, platform, source, active, notes, created_at, updated_at)
          VALUES (?, 'instagram', ?, 1, NULL, ?, ?)
          ON CONFLICT(handle) DO UPDATE SET
            source = COALESCE(excluded.source, content_competitors.source),
            active = 1,
            updated_at = excluded.updated_at
        `);
        let imported = 0;
        for (const h of handles) {
          stmt.run(h, source, now, now);
          imported += 1;
        }
        return res.json({ ok: true, imported, total: handles.length });
      } catch (e: any) {
        return res.status(500).json({ error: 'Failed to import competitors', details: e?.message || String(e) });
      }
    });

    app.get('/api/content/competitors', (req, res) => {
      const rows = deepScanDb.prepare(`
        SELECT handle, platform, source, active, notes, created_at, updated_at
        FROM content_competitors
        ORDER BY updated_at DESC
        LIMIT 500
      `).all();
      return res.json({ total: rows.length, rows });
    });

    app.post('/api/content/samples/ingest-from-observations', (req, res) => {
      try {
        const limitRaw = Number(req.body?.limit);
        const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(2000, Math.floor(limitRaw)) : 500;
        const rows = deepScanDb.prepare(`
          SELECT artist_handle, profile_facts_json, created_at
          FROM bot_observations
          WHERE profile_facts_json IS NOT NULL
          ORDER BY created_at DESC
          LIMIT ?
        `).all(limit) as Array<{ artist_handle: string | null; profile_facts_json: string | null; created_at: number }>;

        const competitorSet = new Set(
          (deepScanDb.prepare(`SELECT handle FROM content_competitors WHERE active = 1`).all() as Array<{ handle: string }>)
            .map((r) => String(r.handle || '').toLowerCase())
        );
        if (competitorSet.size === 0) return res.status(400).json({ error: 'No active competitors found' });

        const insertStmt = deepScanDb.prepare(`
          INSERT INTO content_samples (
            handle, source_type, post_url, caption, style_tags_json, topic_tag, cta_tag, quality_score, engagement_hint, observed_at, created_at
          ) VALUES (?, 'observation', ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        let inserted = 0;
        for (const r of rows) {
          const handle = String(r.artist_handle || '').replace(/^@/, '').trim().toLowerCase();
          if (!handle || !competitorSet.has(handle)) continue;
          let pf: any = {};
          try { pf = r.profile_facts_json ? JSON.parse(r.profile_facts_json) : {}; } catch {}
          const caption = String(pf?.sampleCaption || '').trim();
          if (!caption) continue;
          const styleTags = detectStyleTags(caption + ' ' + String(pf?.bio || ''));
          const topicTag = detectTopicTag(caption);
          const ctaTag = detectCtaTag(caption);
          const qualityScore = Math.max(1, Math.min(100, 40 + (styleTags.length * 12) + (topicTag === 'showcase' ? 8 : 0) - (topicTag === 'promotion' ? 12 : 0)));
          const engagementHint = Math.max(0.1, Math.min(5, 1 + (topicTag === 'social_proof' ? 1.2 : 0.4) + (ctaTag === 'comment' ? 0.4 : 0)));
          insertStmt.run(
            handle,
            String(pf?.url || ''),
            caption.slice(0, 2000),
            JSON.stringify(styleTags),
            topicTag,
            ctaTag,
            qualityScore,
            engagementHint,
            Number(r.created_at || Date.now()),
            Date.now()
          );
          inserted += 1;
        }
        return res.json({ ok: true, inserted, scanned: rows.length });
      } catch (e: any) {
        return res.status(500).json({ error: 'Failed to ingest content samples', details: e?.message || String(e) });
      }
    });

    app.get('/api/content/samples', (req, res) => {
      const limitRaw = Number(req.query?.limit);
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(1000, Math.floor(limitRaw)) : 200;
      const rows = deepScanDb.prepare(`
        SELECT id, handle, source_type, post_url, caption, style_tags_json, topic_tag, cta_tag, quality_score, engagement_hint, observed_at, created_at
        FROM content_samples
        ORDER BY quality_score DESC, engagement_hint DESC, created_at DESC
        LIMIT ?
      `).all(limit) as Array<any>;
      return res.json({
        total: rows.length,
        rows: rows.map((r) => ({
          ...r,
          styleTags: (() => { try { return JSON.parse(r.style_tags_json || '[]'); } catch { return []; } })()
        }))
      });
    });

    app.post('/api/content/templates/generate', (req, res) => {
      try {
        const horizonDaysRaw = Number(req.body?.horizonDays);
        const horizonDays = Number.isFinite(horizonDaysRaw) && horizonDaysRaw > 0 ? Math.min(30, Math.floor(horizonDaysRaw)) : 7;
        const topRows = deepScanDb.prepare(`
          SELECT topic_tag, cta_tag, style_tags_json
          FROM content_samples
          ORDER BY quality_score DESC, engagement_hint DESC
          LIMIT 300
        `).all() as Array<{ topic_tag: string; cta_tag: string; style_tags_json: string }>;
        const topicCount = new Map<string, number>();
        const styleCount = new Map<string, number>();
        for (const r of topRows) {
          topicCount.set(r.topic_tag || 'showcase', Number(topicCount.get(r.topic_tag || 'showcase') || 0) + 1);
          let tags: string[] = [];
          try { tags = JSON.parse(r.style_tags_json || '[]'); } catch {}
          tags.forEach((t) => styleCount.set(t, Number(styleCount.get(t) || 0) + 1));
        }
        const bestTopics = Array.from(topicCount.entries()).sort((a, b) => b[1] - a[1]).map((x) => x[0]).slice(0, 4);
        const bestStyles = Array.from(styleCount.entries()).sort((a, b) => b[1] - a[1]).map((x) => x[0]).slice(0, 5);
        const defaults = bestTopics.length ? bestTopics : ['showcase', 'education', 'social_proof'];
        const plan: Array<any> = [];
        const ctaByTopic: Record<string, string> = {
          showcase: 'soft',
          education: 'comment',
          social_proof: 'dm',
          promotion: 'link_bio'
        };
        for (let i = 0; i < horizonDays; i++) {
          const topic = defaults[i % defaults.length];
          const style = bestStyles.length ? bestStyles[i % bestStyles.length] : 'tattoo';
          const cta = ctaByTopic[topic] || 'soft';
          plan.push({
            day: i + 1,
            topic,
            style,
            format: i % 3 === 0 ? 'reel' : 'image_carousel',
            hook: topic === 'education' ? 'Quick pro tip for tattoo artists' : topic === 'social_proof' ? 'Client result spotlight' : 'Fresh work detail breakdown',
            cta
          });
        }
        const id = `tpl_${Date.now()}`;
        const payload = { id, horizonDays, bestTopics, bestStyles, plan, generatedAt: new Date().toISOString() };
        deepScanDb.prepare(`
          INSERT INTO content_templates (id, payload, created_at) VALUES (?, ?, ?)
        `).run(id, JSON.stringify(payload), Date.now());
        return res.json({ ok: true, template: payload });
      } catch (e: any) {
        return res.status(500).json({ error: 'Failed to generate templates', details: e?.message || String(e) });
      }
    });

    app.get('/api/content/templates', (req, res) => {
      const rows = deepScanDb.prepare(`
        SELECT id, payload, created_at
        FROM content_templates
        ORDER BY created_at DESC
        LIMIT 20
      `).all() as Array<{ id: string; payload: string; created_at: number }>;
      return res.json({
        total: rows.length,
        rows: rows.map((r) => {
          let payload: any = {};
          try { payload = JSON.parse(r.payload || '{}'); } catch {}
          return { id: r.id, createdAt: new Date(Number(r.created_at)).toISOString(), payload };
        })
      });
    });

    // ============ Content Engagement (feedback loop for content-bot) ============

    app.post('/api/content/engagement', (req, res) => {
      try {
        const contentId = String(req.body?.contentId || '').trim();
        const likes = Number(req.body?.likes) || 0;
        const comments = Number(req.body?.comments) || 0;
        const views = Number(req.body?.views) || 0;
        if (!contentId) return res.status(400).json({ error: 'contentId is required' });
        const now = Date.now();
        deepScanDb.prepare(`
          INSERT INTO content_engagement (content_id, likes, comments, views, reported_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(content_id) DO UPDATE SET likes = excluded.likes, comments = excluded.comments, views = excluded.views, reported_at = excluded.reported_at
        `).run(contentId, likes, comments, views, now);
        return res.json({ ok: true, contentId, likes, comments, views });
      } catch (e: any) {
        return res.status(500).json({ error: 'engagement_report_failed', details: e?.message || String(e) });
      }
    });

    app.get('/api/content/engagement/:contentId', (req, res) => {
      try {
        const contentId = String(req.params?.contentId || '').trim();
        if (!contentId) return res.status(400).json({ error: 'contentId is required' });
        const row = deepScanDb.prepare(`SELECT content_id, likes, comments, views, reported_at FROM content_engagement WHERE content_id = ?`).get(contentId) as any;
        if (!row) return res.json({ contentId, likes: null, comments: null, views: null });
        return res.json({ contentId: row.content_id, likes: row.likes, comments: row.comments, views: row.views, reportedAt: new Date(Number(row.reported_at)).toISOString() });
      } catch (e: any) {
        return res.status(500).json({ error: 'engagement_lookup_failed', details: e?.message || String(e) });
      }
    });

    const DEFAULT_BRAND_PROFILE = {
      brandName: 'PEACH Tattoo Supply',
      primaryLine: 'cartridge',
      productLines: ['cartridge', 'tattoo needles', 'pmu cartridges', 'machines', 'accessories'],
      valueProps: ['stable ink flow', 'precision', 'consistent quality', 'sterile safety'],
      bannedWords: ['guaranteed cure', 'medical claim', 'instant miracle'],
      tone: 'professional_friendly',
      ctaStyle: 'soft_dm'
    };

    app.get('/api/llm/brand-profile', (req, res) => {
      const row = deepScanDb.prepare(`SELECT payload, updated_at FROM llm_brand_profile WHERE id = 'default'`).get() as { payload: string; updated_at: number } | undefined;
      if (!row) return res.json({ profile: DEFAULT_BRAND_PROFILE, updatedAt: null });
      let payload: any = DEFAULT_BRAND_PROFILE;
      try { payload = JSON.parse(row.payload || '{}'); } catch {}
      return res.json({ profile: payload, updatedAt: new Date(Number(row.updated_at)).toISOString() });
    });

    app.post('/api/llm/brand-profile', (req, res) => {
      const now = Date.now();
      const incoming = req.body?.profile && typeof req.body.profile === 'object' ? req.body.profile : {};
      const merged = { ...DEFAULT_BRAND_PROFILE, ...incoming };
      deepScanDb.prepare(`
        INSERT INTO llm_brand_profile (id, payload, updated_at)
        VALUES ('default', ?, ?)
        ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
      `).run(JSON.stringify(merged), now);
      return res.json({ ok: true, profile: merged, updatedAt: new Date(now).toISOString() });
    });

    const createLlmTask = (pipeline: 'comment_pipeline' | 'content_pipeline', payload: any, runAt: number = Date.now()) => {
      const now = Date.now();
      const id = `llm_${pipeline === 'comment_pipeline' ? 'cmt' : 'cnt'}_${now}_${Math.random().toString(36).slice(2, 8)}`;
      deepScanDb.prepare(`
        INSERT INTO llm_tasks (
          id, pipeline, payload, status, run_at, lease_until, leased_by, attempts, max_attempts, error_reason, result_json, created_at, updated_at
        ) VALUES (?, ?, ?, 'pending', ?, NULL, NULL, 0, 3, NULL, NULL, ?, ?)
      `).run(id, pipeline, JSON.stringify(payload || {}), runAt, now, now);
      return id;
    };

    app.post('/api/llm/tasks/create-comment', (req, res) => {
      const handle = String(req.body?.artistHandle || '').replace(/^@/, '').trim();
      if (!handle) return res.status(400).json({ error: 'artistHandle is required' });
      const postContext = String(req.body?.postContext || '').trim();
      const id = createLlmTask('comment_pipeline', {
        artistHandle: handle,
        postContext,
        intent: 'engage_for_followback'
      });
      return res.json({ ok: true, taskId: id });
    });

    app.post('/api/llm/tasks/create-content', (req, res) => {
      const platform = String(req.body?.platform || 'instagram').toLowerCase();
      const topic = String(req.body?.topic || 'showcase').toLowerCase();
      const style = String(req.body?.style || 'tattoo').toLowerCase();
      const days = Math.max(1, Math.min(30, Number(req.body?.days || 7)));
      const id = createLlmTask('content_pipeline', {
        platform,
        topic,
        style,
        days,
        intent: 'content_output'
      });
      return res.json({ ok: true, taskId: id });
    });

    app.get('/api/llm/tasks', (req, res) => {
      const pipeline = String(req.query?.pipeline || '').trim();
      const limit = Math.max(1, Math.min(500, Number(req.query?.limit || 100)));
      const rows = pipeline
        ? deepScanDb.prepare(`SELECT * FROM llm_tasks WHERE pipeline = ? ORDER BY created_at DESC LIMIT ?`).all(pipeline, limit)
        : deepScanDb.prepare(`SELECT * FROM llm_tasks ORDER BY created_at DESC LIMIT ?`).all(limit);
      return res.json({ total: rows.length, rows });
    });

    app.post('/api/llm/tasks/next', (req, res) => {
      const pipeline = String(req.body?.pipeline || '').trim();
      const workerId = String(req.body?.workerId || 'llm_worker').trim();
      if (!pipeline) return res.status(400).json({ error: 'pipeline is required' });
      const now = Date.now();
      const leaseMs = Math.max(10000, Math.min(300000, Number(req.body?.leaseMs || 90000)));
      const row = deepScanDb.prepare(`
        SELECT id, pipeline, payload, attempts, max_attempts
        FROM llm_tasks
        WHERE pipeline = ?
          AND status = 'pending'
          AND run_at <= ?
        ORDER BY run_at ASC, created_at ASC
        LIMIT 1
      `).get(pipeline, now) as any;
      if (!row) return res.json({ ok: true, task: null });
      deepScanDb.prepare(`
        UPDATE llm_tasks
        SET status = 'leased', lease_until = ?, leased_by = ?, updated_at = ?
        WHERE id = ?
      `).run(now + leaseMs, workerId, now, row.id);
      let payload: any = {};
      try { payload = JSON.parse(row.payload || '{}'); } catch {}
      return res.json({ ok: true, task: { ...row, payload } });
    });

    app.post('/api/llm/tasks/report', (req, res) => {
      const id = String(req.body?.taskId || '').trim();
      const status = String(req.body?.status || '').trim().toLowerCase();
      const result = req.body?.result && typeof req.body.result === 'object' ? req.body.result : {};
      const reason = String(req.body?.reason || '').trim();
      if (!id) return res.status(400).json({ error: 'taskId is required' });
      const now = Date.now();
      if (status === 'done') {
        deepScanDb.prepare(`
          UPDATE llm_tasks
          SET status = 'done', result_json = ?, updated_at = ?, lease_until = NULL, leased_by = NULL
          WHERE id = ?
        `).run(JSON.stringify(result || {}), now, id);
        return res.json({ ok: true });
      }
      deepScanDb.prepare(`
        UPDATE llm_tasks
        SET status = 'failed', error_reason = ?, updated_at = ?, lease_until = NULL, leased_by = NULL
        WHERE id = ?
      `).run(reason || 'unknown', now, id);
      return res.json({ ok: true });
    });

    app.post('/api/publish/tasks/create', (req, res) => {
      try {
        const platform = String(req.body?.platform || '').trim().toLowerCase();
        if (!platform) return res.status(400).json({ error: 'platform is required' });
        const botId = req.body?.botId ? String(req.body.botId).trim() : null;
        const accountId = req.body?.accountId ? String(req.body.accountId).trim() : null;
        const contentId = req.body?.contentId ? String(req.body.contentId).trim() : null;
        const payload = req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : {};
        const scheduledAtRaw = Number(req.body?.scheduledAt);
        const scheduledAt = Number.isFinite(scheduledAtRaw) ? Math.max(Date.now(), Math.floor(scheduledAtRaw)) : Date.now();
        const now = Date.now();
        const id = `pub_${platform}_${now}_${Math.random().toString(36).slice(2, 8)}`;
        deepScanDb.prepare(`
          INSERT INTO content_publish_tasks (
            id, platform, bot_id, account_id, content_id, payload, status, scheduled_at, lease_until, leased_by,
            published_at, platform_post_id, error_reason, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, NULL, NULL, NULL, NULL, NULL, ?, ?)
        `).run(id, platform, botId, accountId, contentId, JSON.stringify(payload || {}), scheduledAt, now, now);
        return res.json({ ok: true, taskId: id });
      } catch (e: any) {
        return res.status(500).json({ error: 'publish_task_create_failed', details: e?.message || String(e) });
      }
    });

    app.post('/api/publish/tasks/create-batch', (req, res) => {
      try {
        const platform = String(req.body?.platform || '').trim().toLowerCase();
        const accountId = req.body?.accountId ? String(req.body.accountId).trim() : null;
        const botId = req.body?.botId ? String(req.body.botId).trim() : null;
        const contentIdPrefix = String(req.body?.contentIdPrefix || 'content').trim();
        const plan = Array.isArray(req.body?.plan) ? req.body.plan : [];
        if (!platform) return res.status(400).json({ error: 'platform is required' });
        if (!plan.length) return res.status(400).json({ error: 'plan is required' });
        const now = Date.now();
        let created = 0;
        const baseTs = Number.isFinite(Number(req.body?.startAt)) ? Number(req.body.startAt) : now;
        const intervalMin = Math.max(30, Math.min(7 * 24 * 60, Number(req.body?.intervalMin || 24 * 60)));
        const stmt = deepScanDb.prepare(`
          INSERT INTO content_publish_tasks (
            id, platform, bot_id, account_id, content_id, payload, status, scheduled_at, lease_until, leased_by,
            published_at, platform_post_id, error_reason, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, NULL, NULL, NULL, NULL, NULL, ?, ?)
        `);
        plan.forEach((item: any, idx: number) => {
          const id = `pub_${platform}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const contentId = `${contentIdPrefix}_${idx + 1}`;
          const scheduledAt = baseTs + idx * intervalMin * 60 * 1000;
          stmt.run(id, platform, botId, accountId, contentId, JSON.stringify(item || {}), scheduledAt, now, now);
          created += 1;
        });
        return res.json({ ok: true, created });
      } catch (e: any) {
        return res.status(500).json({ error: 'publish_task_create_batch_failed', details: e?.message || String(e) });
      }
    });

    app.get('/api/publish/tasks', (req, res) => {
      try {
        const status = String(req.query?.status || '').trim().toLowerCase();
        const platform = String(req.query?.platform || '').trim().toLowerCase();
        const botId = String(req.query?.botId || '').trim();
        const limit = Math.max(1, Math.min(1000, Number(req.query?.limit || 200)));
        const where: string[] = [];
        const params: any[] = [];
        if (status) { where.push('status = ?'); params.push(status); }
        if (platform) { where.push('platform = ?'); params.push(platform); }
        if (botId) { where.push('bot_id = ?'); params.push(botId); }
        const sqlWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const rows = deepScanDb.prepare(`
          SELECT id, platform, bot_id, account_id, content_id, payload, status, scheduled_at, lease_until, leased_by,
                 published_at, platform_post_id, error_reason, created_at, updated_at
          FROM content_publish_tasks
          ${sqlWhere}
          ORDER BY scheduled_at ASC, created_at DESC
          LIMIT ?
        `).all(...params, limit) as any[];
        return res.json({
          total: rows.length,
          rows: rows.map((r) => {
            let payload = {};
            try { payload = r.payload ? JSON.parse(r.payload) : {}; } catch {}
            return { ...r, payload };
          })
        });
      } catch (e: any) {
        return res.status(500).json({ error: 'publish_tasks_list_failed', details: e?.message || String(e) });
      }
    });

    app.get('/api/publish/poll', (req, res) => {
      try {
        const botId = String(req.query?.botId || '').trim();
        const platform = String(req.query?.platform || '').trim().toLowerCase();
        const leaseMs = Math.max(10000, Math.min(10 * 60 * 1000, Number(req.query?.leaseMs || 90000)));
        if (!botId) return res.status(400).json({ error: 'botId is required' });
        const onlineState = getBotOnlineState(botId);
        if (!onlineState.exists || !onlineState.online) {
          return res.status(409).json({ error: 'Bot is offline. Send heartbeat first.' });
        }
        if (onlineState.paused) return res.status(423).json({ error: 'Bot is paused.' });
        const now = Date.now();
        const row = deepScanDb.prepare(`
          SELECT id, platform, bot_id, account_id, content_id, payload, status, scheduled_at
          FROM content_publish_tasks
          WHERE status = 'pending'
            AND scheduled_at <= ?
            AND (bot_id IS NULL OR bot_id = ?)
            ${platform ? 'AND platform = ?' : ''}
          ORDER BY scheduled_at ASC, created_at ASC
          LIMIT 1
        `).get(...(platform ? [now, botId, platform] : [now, botId])) as any;
        if (!row) return res.json({ ok: true, leaseMs, task: null });
        deepScanDb.prepare(`
          UPDATE content_publish_tasks
          SET status = 'leased', lease_until = ?, leased_by = ?, updated_at = ?
          WHERE id = ?
        `).run(now + leaseMs, botId, now, row.id);
        let payload = {};
        try { payload = row.payload ? JSON.parse(row.payload) : {}; } catch {}
        return res.json({ ok: true, leaseMs, task: { ...row, payload } });
      } catch (e: any) {
        return res.status(500).json({ error: 'publish_poll_failed', details: e?.message || String(e) });
      }
    });

    app.post('/api/publish/report', (req, res) => {
      try {
        const taskId = String(req.body?.taskId || '').trim();
        const status = String(req.body?.status || '').trim().toLowerCase(); // done | failed | pending
        const platformPostId = req.body?.platformPostId ? String(req.body.platformPostId).trim() : null;
        const reason = req.body?.reason ? String(req.body.reason).trim() : null;
        const updatedPayload = req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : null;
        if (!taskId) return res.status(400).json({ error: 'taskId is required' });
        const now = Date.now();
        if (status === 'done') {
          deepScanDb.prepare(`
            UPDATE content_publish_tasks
            SET status = 'done',
                published_at = ?,
                platform_post_id = ?,
                error_reason = NULL,
                lease_until = NULL,
                leased_by = NULL,
                payload = COALESCE(?, payload),
                updated_at = ?
            WHERE id = ?
          `).run(now, platformPostId, updatedPayload ? JSON.stringify(updatedPayload) : null, now, taskId);
          return res.json({ ok: true, taskId, status: 'done' });
        }
        if (status === 'pending') {
          deepScanDb.prepare(`
            UPDATE content_publish_tasks
            SET status = 'pending',
                lease_until = NULL,
                leased_by = NULL,
                error_reason = ?,
                payload = COALESCE(?, payload),
                updated_at = ?
            WHERE id = ?
          `).run(reason, updatedPayload ? JSON.stringify(updatedPayload) : null, now, taskId);
          return res.json({ ok: true, taskId, status: 'pending' });
        }
        if (status === 'pending_media') {
          deepScanDb.prepare(`
            UPDATE content_publish_tasks
            SET status = 'pending_media',
                lease_until = NULL,
                leased_by = NULL,
                error_reason = ?,
                payload = COALESCE(?, payload),
                updated_at = ?
            WHERE id = ?
          `).run(reason || 'no_media_files', updatedPayload ? JSON.stringify(updatedPayload) : null, now, taskId);
          return res.json({ ok: true, taskId, status: 'pending_media' });
        }
        deepScanDb.prepare(`
          UPDATE content_publish_tasks
          SET status = 'failed',
              error_reason = ?,
              lease_until = NULL,
              leased_by = NULL,
              payload = COALESCE(?, payload),
              updated_at = ?
          WHERE id = ?
        `).run(reason || 'unknown', updatedPayload ? JSON.stringify(updatedPayload) : null, now, taskId);
        return res.json({ ok: true, taskId, status: 'failed' });
      } catch (e: any) {
        return res.status(500).json({ error: 'publish_report_failed', details: e?.message || String(e) });
      }
    });

    // GET /api/publish/tasks/pending-media — list tasks waiting for media
    app.get('/api/publish/tasks/pending-media', (req, res) => {
      try {
        const limit = Math.max(1, Math.min(100, Number(req.query?.limit || 50)));
        const rows = deepScanDb.prepare(`
          SELECT id, platform, bot_id, payload, status, error_reason, scheduled_at, created_at
          FROM content_publish_tasks
          WHERE status = 'pending_media'
          ORDER BY created_at DESC
          LIMIT ?
        `).all(limit) as Array<Record<string, any>>;
        return res.json({
          total: rows.length,
          tasks: rows.map(r => ({
            id: r.id,
            platform: r.platform,
            botId: r.bot_id,
            status: r.status,
            errorReason: r.error_reason,
            scheduledAt: r.scheduled_at,
            createdAt: r.created_at,
            payload: (() => { try { return r.payload ? JSON.parse(r.payload) : {}; } catch { return {}; } })()
          }))
        });
      } catch (e: any) {
        return res.status(500).json({ error: 'pending_media_list_failed', details: e?.message || String(e) });
      }
    });

    // POST /api/publish/tasks/:id/attach-media — attach media files to a pending_media task
    app.post('/api/publish/tasks/:id/attach-media', (req, res) => {
      try {
        const taskId = String(req.params?.id || '').trim();
        const mediaFiles = Array.isArray(req.body?.mediaFiles) ? req.body.mediaFiles.filter((f: string) => typeof f === 'string' && f.trim()) : [];
        if (!taskId) return res.status(400).json({ error: 'taskId is required' });
        if (mediaFiles.length === 0) return res.status(400).json({ error: 'mediaFiles array is required' });

        const row = deepScanDb.prepare(`
          SELECT id, payload FROM content_publish_tasks WHERE id = ?
        `).get(taskId) as Record<string, any> | undefined;
        if (!row) return res.status(404).json({ error: 'task_not_found' });

        let payload: any = {};
        try { payload = row.payload ? JSON.parse(row.payload) : {}; } catch {}
        payload.mediaFiles = mediaFiles;

        const now = Date.now();
        deepScanDb.prepare(`
          UPDATE content_publish_tasks
          SET status = 'pending',
              payload = ?,
              error_reason = NULL,
              lease_until = NULL,
              leased_by = NULL,
              updated_at = ?
          WHERE id = ?
        `).run(JSON.stringify(payload), now, taskId);

        return res.json({ ok: true, taskId, status: 'pending', mediaFiles });
      } catch (e: any) {
        return res.status(500).json({ error: 'attach_media_failed', details: e?.message || String(e) });
      }
    });

    const isHourWithinWindow = (hour: number, startHour: number, endHour: number) => {
      if (startHour === endHour) return true;
      if (startHour < endHour) return hour >= startHour && hour < endHour;
      return hour >= startHour || hour < endHour;
    };

    app.post('/api/automation/start', (req, res) => {
      const { artistId, accountId, behaviorProfile, artistHandle, accountHandle, humanization, accountProfile, language } = req.body;
      
      const localHour = Number.isFinite(humanization?.localHour) ? humanization.localHour : new Date().getHours();
      const sleepStart = accountProfile?.sleepWindow?.startHour ?? 23;
      const sleepEnd = accountProfile?.sleepWindow?.endHour ?? 7;
      const isSleeping = isHourWithinWindow(localHour, sleepStart, sleepEnd);

      if (isSleeping) {
        console.log(`[Automation] REJECTED: @${accountHandle} is currently in SLEEP mode (Night Cycle).`);
        return res.status(403).json({ 
          status: 'rejected', 
          reason: 'account_sleeping',
          message: 'Account is in mandatory night-time sleep cycle to prevent detection.' 
        });
      }

      const activeStart = accountProfile?.activeWindow?.startHour ?? 9;
      const activeEnd = accountProfile?.activeWindow?.endHour ?? 21;
      const isOutsideActiveWindow = !isHourWithinWindow(localHour, activeStart, activeEnd);
      if (isOutsideActiveWindow) {
        return res.status(425).json({
          status: 'delayed',
          reason: 'outside_active_window',
          message: `Account is outside active window (${activeStart}:00-${activeEnd}:00).`
        });
      }

      const breakProbability = accountProfile?.breakProbability ?? 0.15;
      const isOnBreak = Math.random() < breakProbability;
      if (isOnBreak) {
        const breakDuration = 5 + Math.floor(Math.random() * 25);
        console.log(`[Automation] DELAYED: @${accountHandle} is taking a random break for ${breakDuration}m.`);
        return res.status(429).json({ 
          status: 'delayed', 
          reason: 'taking_break',
          message: `Account is taking a natural break. Try again in ${breakDuration} minutes.` 
        });
      }

      const jitterRange = humanization?.jitterRange || [30, 180];
      const getJitter = () => Math.floor(Math.random() * (jitterRange[1] - jitterRange[0] + 1)) + jitterRange[0];

      const command = {
        id: `cmd_${Date.now()}`,
        artistId,
        accountId,
        artistHandle,
        accountHandle,
        behaviorProfile,
        language: language || 'en',
        timestamp: new Date().toISOString(),
        accountProfile,
        humanization,
        protocol: {
          steps: [
            { action: 'simulate_app_open', delay: getJitter() },
            { action: 'browse_feed', duration: `${10 + Math.floor(Math.random() * 20)}s`, delay: getJitter() },
            { action: 'enter_profile', target: artistHandle, delay: getJitter() },
            { action: 'random_scroll', duration: `${5 + Math.floor(Math.random() * 15)}s`, delay: getJitter() },
            ...Array.from({ length: humanization?.sessionLikes || 1 }).map((_, i) => ({
              action: 'like',
              target: i === 0 ? 'recent_post' : 'random_post',
              delay: getJitter()
            })),
            { 
              action: 'comment', 
              enabled: (behaviorProfile === 'active' || behaviorProfile === 'warmup') && (humanization?.sessionComments > 0),
              type: 'ai_generated', 
              language: language || 'en',
              delay: getJitter() 
            },
            { action: 'exit_profile', delay: getJitter() },
            { action: 'random_scroll', duration: '10s', delay: getJitter() }
          ],
          jitterRange: jitterRange
        }
      };

      const runAt = Number.isFinite(Number(req.body?.runAt))
        ? Math.max(Date.now(), Number(req.body.runAt))
        : Date.now();
      deepScanDb
        .prepare(`
          INSERT INTO automation_tasks (
            id, payload, status, run_at, lease_until, leased_by, attempts, max_attempts, error_reason, created_at, updated_at
          ) VALUES (?, ?, 'pending', ?, NULL, NULL, 0, 3, NULL, ?, ?)
        `)
        .run(command.id, JSON.stringify(command), runAt, Date.now(), Date.now());
      console.log(`[Automation] Command queued: @${accountHandle} -> @${artistHandle} (${behaviorProfile})`);
      res.json({ status: 'queued', commandId: command.id, runAt });
    });

    app.get('/api/automation/poll', (req, res) => {
      if (!requireBotAuth(req, res)) return;
      const botId = String(req.query?.botId || '').trim();
      if (!botId) return res.status(400).json({ error: 'botId is required' });
      const onlineState = getBotOnlineState(botId);
      if (!onlineState.exists) {
        return res.status(404).json({ error: 'Bot not registered' });
      }
      if (!onlineState.online) {
        if (onlineState.paused) {
          return res.status(423).json({ error: 'Bot is paused. Resume first.' });
        }
        return res.status(409).json({ error: 'Bot is offline. Send heartbeat first.' });
      }

      const limitRaw = Number(req.query?.limit);
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(50, Math.floor(limitRaw)) : 10;
      const taskType = String(req.query?.taskType || '').trim(); // optional: ig_outreach | reddit_scrape | supply_analysis

      recycleExpiredAutomationLeases();
      const now = Date.now();
      const DEDUP_WINDOW = 7 * 24 * 60 * 60 * 1000;

      // Auto-skip stale pending tasks where same artist already has a done task within 7 days
      const staleCleanup = deepScanDb.prepare(`
        UPDATE automation_tasks
        SET status = 'done', updated_at = ?
        WHERE status = 'pending'
          AND id IN (
            SELECT p.id FROM automation_tasks p
            WHERE p.status = 'pending'
              AND EXISTS (
                SELECT 1 FROM automation_tasks d
                WHERE d.status = 'done'
                  AND json_extract(d.payload, '$.artistHandle') = json_extract(p.payload, '$.artistHandle')
                  AND json_extract(d.payload, '$.artistHandle') IS NOT NULL
                  AND d.updated_at > ?
              )
          )
      `);
      staleCleanup.run(now, now - DEDUP_WINDOW);

      // Build candidate query with optional taskType filter
      // IG outreach tasks (legacy) have no taskType field → match ig_outreach or empty filter
      const taskTypeFilter = taskType
        ? taskType === 'ig_outreach'
          ? `AND (json_extract(payload, '$.taskType') IS NULL OR json_extract(payload, '$.taskType') = 'ig_outreach')`
          : `AND json_extract(payload, '$.taskType') = '${taskType.replace(/[^a-z_]/g, '')}'`
        : '';
      const candidates = deepScanDb
        .prepare(`
          SELECT id, payload
          FROM automation_tasks
          WHERE status = 'pending' AND run_at <= ? ${taskTypeFilter}
          ORDER BY run_at ASC
          LIMIT ?
        `)
        .all(now, Math.max(limit * 3, limit)) as Array<{ id: string; payload: string }>;

      const leased: any[] = [];
      for (const row of candidates) {
        if (leased.length >= limit) break;
        // Double-check dedup at lease time (use artistHandle — works for both artist & competitor tasks)
        const artistHandle = (() => { try { return JSON.parse(row.payload)?.artistHandle; } catch { return null; } })();
        if (artistHandle) {
          const alreadyDone = deepScanDb.prepare(`
            SELECT 1 FROM automation_tasks
            WHERE status = 'done'
              AND json_extract(payload, '$.artistHandle') = ?
              AND updated_at > ?
            LIMIT 1
          `).get(artistHandle, now - DEDUP_WINDOW);
          if (alreadyDone) {
            deepScanDb.prepare(`UPDATE automation_tasks SET status = 'done', updated_at = ? WHERE id = ?`).run(now, row.id);
            continue;
          }
        }
        const updated = deepScanDb
          .prepare(`
            UPDATE automation_tasks
            SET status = 'leased',
                lease_until = ?,
                leased_by = ?,
                attempts = attempts + 1,
                updated_at = ?
            WHERE id = ? AND status = 'pending'
          `)
          .run(now + BOT_LEASE_MS, botId, now, row.id);
        if ((updated.changes || 0) > 0) {
          try {
            leased.push(JSON.parse(row.payload));
          } catch {
            // Ignore malformed payload rows
          }
        }
      }

      return res.json({
        botId,
        leaseMs: BOT_LEASE_MS,
        commands: leased
      });
    });

    app.get('/api/automation/tasks', (req, res) => {
      const limitRaw = Number(req.query?.limit);
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(1000, Math.floor(limitRaw)) : 200;
      const status = String(req.query?.status || '').trim().toLowerCase();
      const now = Date.now();
      recycleExpiredAutomationLeases();

      const rows = (status
        ? deepScanDb
            .prepare(`
              SELECT id, payload, status, run_at, lease_until, leased_by, attempts, max_attempts, error_reason, created_at, updated_at
              FROM automation_tasks
              WHERE status = ?
              ORDER BY run_at ASC, updated_at DESC
              LIMIT ?
            `)
            .all(status, limit)
        : deepScanDb
            .prepare(`
              SELECT id, payload, status, run_at, lease_until, leased_by, attempts, max_attempts, error_reason, created_at, updated_at
              FROM automation_tasks
              ORDER BY
                CASE status
                  WHEN 'pending' THEN 0
                  WHEN 'leased' THEN 1
                  WHEN 'running' THEN 2
                  WHEN 'failed' THEN 3
                  WHEN 'done' THEN 4
                  ELSE 5
                END ASC,
                run_at ASC,
                updated_at DESC
              LIMIT ?
            `)
            .all(limit)) as Array<{
        id: string;
        payload: string;
        status: string;
        run_at: number;
        lease_until: number | null;
        leased_by: string | null;
        attempts: number;
        max_attempts: number;
        error_reason: string | null;
        created_at: number;
        updated_at: number;
      }>;

      const tasks = rows.map((r) => ({
        id: r.id,
        payload: r.payload,
        status: r.status,
        runAt: r.run_at,
        leaseUntil: r.lease_until,
        leasedBy: r.leased_by,
        attempts: r.attempts,
        maxAttempts: r.max_attempts,
        errorReason: r.error_reason,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        overdue: r.status === 'pending' ? r.run_at <= now : false
      }));

      return res.json({ ok: true, total: tasks.length, tasks });
    });

    app.get('/api/automation/stats', (_req, res) => {
      recycleExpiredAutomationLeases();
      const rows = deepScanDb
        .prepare(`
          SELECT status, COUNT(*) AS cnt
          FROM automation_tasks
          GROUP BY status
        `)
        .all() as Array<{ status: string; cnt: number }>;

      const counts: Record<string, number> = {
        pending: 0,
        leased: 0,
        running: 0,
        done: 0,
        failed: 0
      };
      for (const r of rows) counts[String(r.status || 'unknown')] = Number(r.cnt || 0);
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      return res.json({ ok: true, total, counts });
    });

    app.post('/api/automation/report', (req, res) => {
      if (!requireBotAuth(req, res)) return;
      const botId = String(req.body?.botId || '').trim();
      const commandId = String(req.body?.commandId || '').trim();
      const status = String(req.body?.status || '').trim().toLowerCase();
      const errorReason = req.body?.reason ? String(req.body.reason) : null;
      if (!botId || !commandId) {
        return res.status(400).json({ error: 'botId and commandId are required' });
      }
      if (status !== 'done' && status !== 'failed') {
        return res.status(400).json({ error: 'status must be done or failed' });
      }

      const onlineState = getBotOnlineState(botId);
      if (!onlineState.exists) {
        return res.status(404).json({ error: 'Bot not registered' });
      }

      const now = Date.now();
      const updated = deepScanDb
        .prepare(`
          UPDATE automation_tasks
          SET status = ?,
              lease_until = NULL,
              leased_by = NULL,
              error_reason = ?,
              updated_at = ?
          WHERE id = ? AND leased_by = ? AND status IN ('leased','running')
        `)
        .run(status, status === 'failed' ? (errorReason || 'unknown') : null, now, commandId, botId);

      if ((updated.changes || 0) === 0) {
        return res.status(409).json({ error: 'Task not leased by this bot or already resolved' });
      }
      return res.json({ ok: true, commandId, status });
    });

    // Reset failed/pending tasks back to pending (admin)
    app.post('/api/automation/reset-tasks', (req, res) => {
      const ids = req.body?.ids;
      const maxAttempts = Math.max(1, Math.min(5, Number(req.body?.maxAttempts) || 3));
      const status = String(req.body?.status || 'failed').trim();

      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'ids array required' });
      }

      const now = Date.now();
      const placeholders = ids.map(() => '?').join(',');
      const result = deepScanDb
        .prepare(`UPDATE automation_tasks SET status = 'pending', error_reason = NULL, leased_by = NULL, lease_until = NULL, attempts = 0, max_attempts = ?, updated_at = ? WHERE id IN (${placeholders}) AND status = ?`)
        .run(maxAttempts, now, ...ids, status);

      return res.json({ ok: true, updated: result.changes || 0 });
    });

    // ========== Intel Review Web UI — human verification interface ==========
    app.get('/intel/review', (_req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>InkFlow — AI Review Queue</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #e2e8f0; }
.header { background: #1e293b; padding: 16px 24px; border-bottom: 1px solid #334155; display: flex; justify-content: space-between; align-items: center; }
.header h1 { font-size: 18px; }
.stats { display: flex; gap: 16px; font-size: 13px; }
.stat { padding: 4px 12px; border-radius: 6px; background: #334155; }
.stat.pending { background: #854d0e; }
.stat.approved { background: #166534; }
.stat.rejected { background: #991b1b; }
.container { max-width: 1200px; margin: 0 auto; padding: 20px; }
.filters { display: flex; gap: 12px; margin-bottom: 20px; align-items: center; }
.filters button { padding: 8px 16px; border: 1px solid #475569; border-radius: 6px; background: #1e293b; color: #e2e8f0; cursor: pointer; font-size: 13px; }
.filters button.active { background: #3b82f6; border-color: #3b82f6; }
.review-card { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 20px; margin-bottom: 16px; }
.review-card .meta { display: flex; gap: 12px; margin-bottom: 12px; font-size: 12px; color: #94a3b8; }
.review-card .meta span { padding: 2px 8px; border-radius: 4px; background: #334155; }
.review-card .meta .conf-low { background: #991b1b; }
.review-card .meta .conf-medium { background: #854d0e; }
.review-card .meta .conf-high { background: #166534; }
.review-card .side-by-side { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 16px; }
.review-card .panel { background: #0f172a; border-radius: 6px; padding: 14px; }
.review-card .panel h3 { font-size: 13px; color: #94a3b8; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
.review-card .panel .text { font-size: 14px; line-height: 1.5; max-height: 200px; overflow-y: auto; }
.review-card .panel .json { font-size: 12px; font-family: monospace; white-space: pre-wrap; max-height: 200px; overflow-y: auto; color: #94a3b8; }
.review-card .actions { display: flex; gap: 10px; }
.review-card .actions button { padding: 8px 20px; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500; }
.btn-approve { background: #166534; color: #fff; }
.btn-correct { background: #1d4ed8; color: #fff; }
.btn-reject { background: #991b1b; color: #fff; }
.btn-approve:hover { background: #15803d; }
.btn-correct:hover { background: #2563eb; }
.btn-reject:hover { background: #b91c1c; }
.correct-form { display: none; margin-top: 12px; padding: 12px; background: #1e3a5f; border-radius: 6px; }
.correct-form textarea { width: 100%; height: 200px; background: #0f172a; color: #e2e8f0; border: 1px solid #475569; border-radius: 4px; padding: 10px; font-family: monospace; font-size: 12px; }
.correct-form .btn-row { display: flex; gap: 8px; margin-top: 8px; justify-content: flex-end; }
.empty { text-align: center; padding: 60px; color: #64748b; }
.loading { text-align: center; padding: 40px; }
.error { background: #991b1b; padding: 12px 20px; border-radius: 6px; margin-bottom: 16px; }
</style>
</head>
<body>
<div class="header">
  <h1>🔍 AI Review Queue — Classification Verification</h1>
  <div class="stats" id="stats"></div>
</div>
<div class="container">
  <div class="filters">
    <button data-filter="pending" class="active">Pending</button>
    <button data-filter="approved">Approved</button>
    <button data-filter="corrected">Corrected</button>
    <button data-filter="rejected">Rejected</button>
    <button data-filter="all">All</button>
    <span style="margin-left:auto;font-size:12px;color:#64748b;" id="bias-warning"></span>
  </div>
  <div id="app">Loading...</div>
</div>
<script>
const API = '/api/intel/review';

async function loadStats() {
  const r = await fetch(API + '/stats');
  const d = await r.json();
  const s = d.accuracyDetail || {};
  document.getElementById('stats').innerHTML =
    '<span class="stat pending">' + (d.reviewStats?.find((x) => x.review_status === 'pending')?.c || 0) + ' pending</span>' +
    '<span class="stat approved">' + (d.reviewStats?.find((x) => x.review_status === 'approved')?.c || 0) + ' approved</span>' +
    '<span class="stat rejected">' + (d.reviewStats?.find((x) => x.review_status === 'rejected')?.c || 0) + ' rejected</span>' +
    (d.accuracy ? '<span class="stat">Accuracy: ' + d.accuracy + '%</span>' : '');
  if (d.biasCheck?.length) {
    const top = d.biasCheck[0];
    document.getElementById('bias-warning').textContent = 'Top: ' + top.dtype + ' (' + top.c + ' pending)';
  }
}

async function loadQueue(filter) {
  const app = document.getElementById('app');
  app.innerHTML = '<div class="loading">Loading...</div>';
  try {
    const r = await fetch(API + '/queue?limit=50&filter=' + filter);
    const d = await r.json();
    if (!d.items?.length) {
      app.innerHTML = '<div class="empty">No items to review 🎉</div>';
      return;
    }
    app.innerHTML = d.items.map((item, idx) => {
      const cls = JSON.parse(item.ai_classification || '{}');
      const confClass = 'conf-' + (item.confidence || 'low');
      return '<div class="review-card" id="card-' + item.id + '">' +
        '<div class="meta">' +
          '<span>#' + item.id + '</span>' +
          '<span>' + item.source_type + '</span>' +
          '<span class="' + confClass + '">' + (item.confidence || '?') + '</span>' +
          '<span>' + (cls.discussion_type || '?') + '</span>' +
          '<span>' + (cls.product_category || '?') + '</span>' +
          (cls.artist_skill_level ? '<span>' + cls.artist_skill_level + '</span>' : '') +
          '<span>' + (item.review_status || 'pending') + '</span>' +
        '</div>' +
        '<div class="side-by-side">' +
          '<div class="panel"><h3>Original Post</h3><div class="text">' + esc(item.original_text || '') + '</div></div>' +
          '<div class="panel"><h3>AI Classification</h3><div class="json">' + esc(JSON.stringify(cls, null, 2)) + '</div></div>' +
        '</div>' +
        (item.review_status === 'pending'
          ? '<div class="actions">' +
              '<button class="btn-approve" onclick="review(' + item.id + ', \\'approve\\')">✓ Approve</button>' +
              '<button class="btn-correct" onclick="showCorrect(' + item.id + ')">✎ Correct</button>' +
              '<button class="btn-reject" onclick="review(' + item.id + ', \\'reject\\')">✗ Reject</button>' +
            '</div>' +
            '<div class="correct-form" id="correct-' + item.id + '">' +
              '<textarea id="correct-json-' + item.id + '">' + esc(JSON.stringify(cls, null, 2)) + '</textarea>' +
              '<div class="btn-row">' +
                '<button onclick="hideCorrect(' + item.id + ')" style="background:#475569;color:#fff;border:none;padding:6px 14px;border-radius:4px;cursor:pointer;">Cancel</button>' +
                '<button onclick="submitCorrect(' + item.id + ')" class="btn-correct">Submit Correction</button>' +
              '</div>' +
            '</div>'
          : '<div style="font-size:12px;color:#94a3b8;">Reviewed: ' + (item.review_status || '?') + '</div>'
        ) +
      '</div>';
    }).join('');
  } catch(e) {
    app.innerHTML = '<div class="error">Error: ' + e.message + '</div>';
  }
}

function esc(s) { return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

async function review(id, action) {
  await fetch(API + '/' + id, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({action})
  });
  document.getElementById('card-' + id).style.opacity = '0.4';
  loadStats();
}

function showCorrect(id) { document.getElementById('correct-' + id).style.display = 'block'; }
function hideCorrect(id) { document.getElementById('correct-' + id).style.display = 'none'; }

async function submitCorrect(id) {
  const json = document.getElementById('correct-json-' + id).value;
  try {
    const corrected = JSON.parse(json);
    await fetch(API + '/' + id, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({action: 'correct', correctedClassification: corrected, notes: 'manually corrected'})
    });
    document.getElementById('card-' + id).style.opacity = '0.4';
    loadStats();
  } catch(e) {
    alert('Invalid JSON: ' + e.message);
  }
}

document.querySelectorAll('.filters button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filters button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    loadQueue(btn.dataset.filter);
  });
});

loadStats();
loadQueue('pending');
</script>
</body>
</html>`);
    });

    // ===================================================================
    // InkFlow Outreach Module — Shared resource pool + dev-only outreach
    // ===================================================================

    // Shared candidate pool (all scraped IG accounts)
    deepScanDb.exec(`
        CREATE TABLE IF NOT EXISTS inkflow_candidates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ig_handle TEXT NOT NULL,
            ig_url TEXT,
            followers INTEGER DEFAULT 0,
            following INTEGER DEFAULT 0,
            posts_count INTEGER DEFAULT 0,
            avg_likes INTEGER DEFAULT 0,
            bio TEXT,
            profile_pic TEXT,
            has_contact_info INTEGER DEFAULT 0,
            contact_email TEXT,
            contact_phone TEXT,
            external_links TEXT,
            last_scraped TEXT,
            status TEXT NOT NULL DEFAULT 'raw',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);
    deepScanDb.exec('CREATE INDEX IF NOT EXISTS idx_inkflow_cand_status ON inkflow_candidates(status)');
    deepScanDb.exec('CREATE INDEX IF NOT EXISTS idx_inkflow_cand_handle ON inkflow_candidates(ig_handle)');

    // InkFlow filtered targets (dev-only visible)
    deepScanDb.exec(`
        CREATE TABLE IF NOT EXISTS inkflow_targets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            candidate_id INTEGER NOT NULL,
            ig_handle TEXT NOT NULL,
            ig_url TEXT,
            followers INTEGER,
            bio TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            contact_method TEXT,
            outreach_message TEXT,
            response TEXT,
            notes TEXT,
            interview_scheduled TEXT,
            case_study_status TEXT DEFAULT 'none',
            plan TEXT DEFAULT 'free',
            trial_ends_at TEXT,
            subscription_status TEXT DEFAULT 'none',
            monthly_revenue INTEGER DEFAULT 0,
            last_contact_at TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            last_updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (candidate_id) REFERENCES inkflow_candidates(id)
        )
    `);
    deepScanDb.exec('CREATE INDEX IF NOT EXISTS idx_inkflow_tgt_status ON inkflow_targets(status)');
    deepScanDb.exec('CREATE INDEX IF NOT EXISTS idx_inkflow_tgt_candidate ON inkflow_targets(candidate_id)');

    // Outreach logs
    deepScanDb.exec(`
        CREATE TABLE IF NOT EXISTS inkflow_outreach_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            target_id INTEGER NOT NULL,
            action TEXT NOT NULL,
            message TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            created_by TEXT,
            FOREIGN KEY (target_id) REFERENCES inkflow_targets(id)
        )
    `);

    // GET all candidates (shared pool, all users can read)
    app.get('/api/inkflow/candidates', (req: any, res: any) => {
        try {
            const status = req.query.status as string || '';
            const page = parseInt(req.query.page as string) || 1;
            const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
            const offset = (page - 1) * limit;
            const query = status
                ? 'SELECT * FROM inkflow_candidates WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
                : 'SELECT * FROM inkflow_candidates ORDER BY created_at DESC LIMIT ? OFFSET ?';
            const results = status
                ? deepScanDb.prepare(query).all(status, limit, offset)
                : deepScanDb.prepare(query).all(limit, offset);
            const totalRows = status
                ? deepScanDb.prepare('SELECT COUNT(*) as total FROM inkflow_candidates WHERE status = ?').get(status)
                : deepScanDb.prepare('SELECT COUNT(*) as total FROM inkflow_candidates').get();
            const total = Number((totalRows as any).total);
            res.json({
                candidates: results,
                pagination: { page, limit, total, pages: Math.ceil(total / limit) },
            });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    // GET inkflow targets (accessible — frontend hides button from non-snow368)
    app.get('/api/inkflow/targets', (req: any, res: any) => {
        try {
            const status = req.query.status as string || '';
            const page = parseInt(req.query.page as string) || 1;
            const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
            const offset = (page - 1) * limit;
            const query = status
                ? 'SELECT * FROM inkflow_targets WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
                : 'SELECT * FROM inkflow_targets ORDER BY created_at DESC LIMIT ? OFFSET ?';
            const results = status
                ? deepScanDb.prepare(query).all(status, limit, offset)
                : deepScanDb.prepare(query).all(limit, offset);
            const totalRows = status
                ? deepScanDb.prepare('SELECT COUNT(*) as total FROM inkflow_targets WHERE status = ?').get(status)
                : deepScanDb.prepare('SELECT COUNT(*) as total FROM inkflow_targets').get();
            const total = Number((totalRows as any).total);
            res.json({
                targets: results,
                pagination: { page, limit, total, pages: Math.ceil(total / limit) },
            });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    // Auto-filter candidates → inkflow targets (accessible — frontend controls visibility)
    app.post('/api/inkflow/auto-filter', (req: any, res: any) => {
        try {
            const stmt = deepScanDb.prepare(`
                INSERT INTO inkflow_targets (candidate_id, ig_handle, ig_url, followers, bio, status, created_at)
                SELECT id, ig_handle, ig_url, followers, bio, 'pending', CURRENT_TIMESTAMP
                FROM inkflow_candidates
                WHERE status = 'raw'
                    AND followers >= 1000
                    AND followers <= 10000
                    AND (LOWER(bio) LIKE '%team%' OR LOWER(bio) LIKE '%staff%' OR LOWER(bio) LIKE '%artists%' OR LOWER(bio) LIKE '%studio%')
                    AND posts_count >= 3
                ON CONFLICT DO NOTHING
            `);
            const result = stmt.run();
            res.json({ filtered: result.changes || 0 });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    // Update target (DEV or USER)
    app.put('/api/inkflow/target/:id', (req: any, res: any) => {
        const { id } = req.params;
        const { status, notes, contact_method, outreach_message, response, interview_scheduled, case_study_status, plan, trial_ends_at, subscription_status, monthly_revenue, last_contact_at } = req.body;
        try {
            deepScanDb.prepare(`
                UPDATE inkflow_targets SET
                    status = COALESCE(?, status), notes = COALESCE(?, notes),
                    contact_method = COALESCE(?, contact_method),
                    outreach_message = COALESCE(?, outreach_message),
                    response = COALESCE(?, response),
                    interview_scheduled = COALESCE(?, interview_scheduled),
                    case_study_status = COALESCE(?, case_study_status),
                    plan = COALESCE(NULLIF(?, ''), plan),
                    trial_ends_at = COALESCE(NULLIF(?, ''), trial_ends_at),
                    subscription_status = COALESCE(NULLIF(?, ''), subscription_status),
                    monthly_revenue = COALESCE(NULLIF(?, 0), monthly_revenue),
                    last_contact_at = COALESCE(NULLIF(?, ''), last_contact_at),
                    last_updated = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(status, notes, contact_method, outreach_message, response, interview_scheduled, case_study_status, plan, trial_ends_at, subscription_status, monthly_revenue, last_contact_at, id);
            res.json({ success: true });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    // Delete target (accessible — frontend controls visibility)
    app.delete('/api/inkflow/target/:id', (req: any, res: any) => {
        try {
            deepScanDb.prepare('DELETE FROM inkflow_targets WHERE id = ?').run(req.params.id);
            res.json({ success: true });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    // Log outreach action (DEV or USER)
    app.post('/api/inkflow/outreach/log', (req: any, res: any) => {
        const { target_id, action, message } = req.body;
        try {
            deepScanDb.prepare(`
                INSERT INTO inkflow_outreach_logs (target_id, action, message, created_at)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            `).run(target_id, action, message);
            const statusMap: Record<string, string> = {
                sent: 'contacted', replied: 'replied', scheduled: 'scheduled',
                trialing: 'trialing', case_study: 'case_study', rejected: 'rejected',
            };
            const newStatus = statusMap[action];
            if (newStatus) {
                deepScanDb.prepare('UPDATE inkflow_targets SET status = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?').run(newStatus, target_id);
            }
            res.json({ success: true });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    // Stats (accessible — frontend controls visibility)
    app.get('/api/inkflow/stats', (req: any, res: any) => {
        try {
            const stats: Record<string, number> = {};
            const rows = deepScanDb.prepare('SELECT status, COUNT(*) as count FROM inkflow_targets GROUP BY status').all();
            rows.forEach((r: any) => { stats[r.status] = r.count; });
            const totalCand = Number(deepScanDb.prepare('SELECT COUNT(*) as total FROM inkflow_candidates').get().total);
            const totalTgt = Number(deepScanDb.prepare('SELECT COUNT(*) as total FROM inkflow_targets').get().total);

            // DM outreach summary from logs
            const dmStats: Record<string, number> = {};
            const dmRows = deepScanDb.prepare(
                "SELECT action, COUNT(*) as cnt FROM inkflow_outreach_logs WHERE action IN ('sent','replied','scheduled','triaging','trialing','case_study','rejected') GROUP BY action"
            ).all();
            dmRows.forEach((r: any) => { dmStats[r.action] = r.cnt; });

            // Revenue & plan breakdown
            const planStats: any = {};
            const planRows = deepScanDb.prepare("SELECT plan, subscription_status, COUNT(*) as cnt, COALESCE(SUM(monthly_revenue), 0) as rev FROM inkflow_targets WHERE plan != 'free' GROUP BY plan, subscription_status").all();
            planRows.forEach((r: any) => {
                const key = `${r.plan}/${r.subscription_status || 'none'}`;
                planStats[key] = { count: r.cnt, revenue: r.rev };
            });
            const totalMrr = Number(deepScanDb.prepare("SELECT COALESCE(SUM(monthly_revenue), 0) as mrr FROM inkflow_targets WHERE plan != 'free' AND subscription_status = 'active'").get().mrr);

            res.json({ candidates: totalCand, targets: totalTgt, byStatus: stats, dmStats, planStats, totalMrr });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    // Bulk ingest candidates (accessible — frontend controls visibility)
    app.post('/api/inkflow/candidates/bulk', (req: any, res: any) => {
        try {
            const { candidates } = req.body;
            const insert = deepScanDb.prepare(`
                INSERT OR IGNORE INTO inkflow_candidates
                    (ig_handle, ig_url, followers, bio, profile_pic, posts_count, has_contact_info, contact_email, external_links, last_scraped, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'raw')
            `);
            const transaction = deepScanDb.transaction((items: any[]) => {
                items.forEach((item: any) => {
                    insert.run(
                        item.ig_handle, item.ig_url, item.followers, item.bio,
                        item.profile_pic, item.posts_count, item.has_contact_info,
                        item.contact_email, JSON.stringify(item.external_links || [])
                    );
                });
            });
            transaction(candidates);
            res.json({ inserted: candidates.length });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    // Get outreach logs for a target (accessible — frontend controls visibility)
    app.get('/api/inkflow/target/:id/logs', (req: any, res: any) => {
        try {
            const logs = deepScanDb.prepare(
                'SELECT * FROM inkflow_outreach_logs WHERE target_id = ? ORDER BY created_at DESC LIMIT 50'
            ).all(req.params.id);
            res.json({ logs });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    // Mark candidate as processed
    app.put('/api/inkflow/candidate/:id/status', (req: any, res: any) => {
        const { status } = req.body;
        try {
            deepScanDb.prepare('UPDATE inkflow_candidates SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, req.params.id);
            res.json({ success: true });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    // ============ Order Fulfillment API ============

    // GET /api/fulfillment/boxes — 包装箱列表
    app.get('/api/fulfillment/boxes', (_req, res) => {
      const boxes = deepScanDb.prepare('SELECT * FROM order_boxes WHERE enabled = 1 ORDER BY max_units ASC').all();
      res.json(boxes);
    });

    // POST /api/fulfillment/boxes — 新增包装箱
    app.post('/api/fulfillment/boxes', (req, res) => {
      const { name, length_cm, width_cm, height_cm, max_units, weight_g, carrier } = req.body || {};
      if (!name || !length_cm || !width_cm || !height_cm) return res.status(400).json({ error: 'name/length/width/height required' });
      deepScanDb.prepare(`
        INSERT INTO order_boxes (name, length_cm, width_cm, height_cm, max_units, weight_g, carrier, enabled, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
      `).run(name, length_cm, width_cm, height_cm, max_units || 0, weight_g || 0, carrier || '', Date.now());
      res.json({ ok: true });
    });

    // DELETE /api/fulfillment/boxes/:id
    app.delete('/api/fulfillment/boxes/:id', (req, res) => {
      deepScanDb.prepare('UPDATE order_boxes SET enabled = 0 WHERE id = ?').run(req.params.id);
      res.json({ ok: true });
    });

    // GET /api/fulfillment/carriers — 物流商配置
    app.get('/api/fulfillment/carriers', (_req, res) => {
      const carriers = deepScanDb.prepare('SELECT id, carrier, label, api_base_url, enabled FROM carrier_configs ORDER BY carrier').all();
      res.json(carriers);
    });

    // POST /api/fulfillment/carriers — 更新物流商配置
    app.post('/api/fulfillment/carriers', (req, res) => {
      const { id, api_key, api_secret, extra_config } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id required' });
      const updates: string[] = []; const vals: any[] = [];
      if (api_key) { updates.push('api_key = ?'); vals.push(api_key); }
      if (api_secret) { updates.push('api_secret = ?'); vals.push(api_secret); }
      if (extra_config) { updates.push('extra_config = ?'); vals.push(JSON.stringify(extra_config)); }
      if (updates.length > 0) { vals.push(id); deepScanDb.prepare(`UPDATE carrier_configs SET ${updates.join(',')} WHERE id = ?`).run(...vals); }
      res.json({ ok: true });
    });

    // GET /api/fulfillment/orders — 订单列表
    app.get('/api/fulfillment/orders', (req, res) => {
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
      const offset = (page - 1) * limit;
      const status = req.query.status as string;
      let sql = 'SELECT * FROM orders WHERE 1=1';
      const vals: any[] = [];
      if (status) { sql += ' AND status = ?'; vals.push(status); }
      sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'; vals.push(limit, offset);
      const orders = deepScanDb.prepare(sql).all(...vals);
      const total = deepScanDb.prepare('SELECT COUNT(*) as c FROM orders').get() as any;
      res.json({ orders, total: total.c, page, limit });
    });

    // GET /api/fulfillment/orders/:id — 订单详情
    app.get('/api/fulfillment/orders/:id', (req, res) => {
      const order = deepScanDb.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
      if (!order) return res.status(404).json({ error: 'not found' });
      const items = deepScanDb.prepare('SELECT * FROM order_items WHERE order_id = ?').all(req.params.id);
            (order as any).gifts = parseNote((order as any).notes || '');
      const shipments = deepScanDb.prepare('SELECT * FROM shipments WHERE order_id = ? ORDER BY created_at DESC').all(req.params.id);
      res.json({ ...order as any, items, shipments });
    });

    // POST /api/fulfillment/orders — 手动创建订单
    app.post('/api/fulfillment/orders', (req, res) => {
      const { order_number, customer_name, country, state, city, zip_code, address, phone, items, notes } = req.body || {};
      if (!order_number || !customer_name || !country) return res.status(400).json({ error: 'order_number/customer_name/country required' });
      const now = Date.now();
      const r = deepScanDb.prepare(`
        INSERT INTO orders (order_number, customer_name, country, state, city, zip_code, address, phone, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(order_number, customer_name, country, state || '', city || '', zip_code || '', address || '', phone || '', notes || '', now, now);
      const orderId = r.lastInsertRowid;
      if (items && Array.isArray(items)) {
        const stmt = deepScanDb.prepare('INSERT INTO order_items (order_id, sku, product_name, quantity, unit_price) VALUES (?, ?, ?, ?, ?)');
        for (const item of items) stmt.run(orderId, item.sku || '', item.product_name || 'Item', item.quantity || 1, item.unit_price || 0);
      }
      res.json({ ok: true, id: orderId });
    });

    // DELETE /api/fulfillment/orders/:id — 删除订单
    app.delete('/api/fulfillment/orders/:id', (req, res) => {
      const id = req.params.id;
      deepScanDb.prepare('DELETE FROM order_items WHERE order_id = ?').run(id);
      deepScanDb.prepare('DELETE FROM shipments WHERE order_id = ?').run(id);
      deepScanDb.prepare('DELETE FROM orders WHERE id = ?').run(id);
      res.json({ ok: true });
    });

    // POST /api/fulfillment/orders/:id/ship — 创建运单
    app.post('/api/fulfillment/orders/:id/ship', async (req, res) => {
      const order = deepScanDb.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id) as any;
      if (!order) return res.status(404).json({ error: 'order not found' });
      const carrier = req.body?.carrier || order.carrier;
      if (!carrier) return res.status(400).json({ error: 'carrier required' });
      const boxId = req.body?.box_id || order.box_id || 0;
      const box = boxId ? deepScanDb.prepare('SELECT * FROM order_boxes WHERE id = ?').get(boxId) as any : null;

      // Build recipient from order
      const receiver = {
        name: order.customer_name,
        phone: order.phone || '',
        country: order.country,
        state: order.state || '',
        city: order.city || '',
        zipCode: order.zip_code || '',
        address: order.address || '',
      };

      // Pick sender from default config (can be overridden later)
      const sender = { name: 'Your Company', phone: '', country: 'CN', address: 'Shenzhen, China' };

      const items = deepScanDb.prepare('SELECT * FROM order_items WHERE order_id = ?').all(req.params.id) as any[];
      const totalWeight = items.reduce((s, i) => s + (i.quantity || 1) * 100, 200);
      const dims = box ? { length: box.length_cm, width: box.width_cm, height: box.height_cm } : { length: 20, width: 15, height: 10 };

      let result;
      if (carrier === 'yanwen') {
        const config = deepScanDb.prepare('SELECT * FROM carrier_configs WHERE carrier = ?').get('yanwen') as any;
        if (!config) return res.status(400).json({ error: 'yanwen not configured' });
        const extra = JSON.parse(config.extra_config || '{}');
        const { createOrder: yanwenCreate } = await import('../engine/scripts/carrier-yanwen');
        result = await yanwenCreate({
          userId: config.api_key,
          apiToken: config.api_secret,
          baseUrl: config.api_base_url,
          channelId: extra.channelId || '481',
        }, {
          orderNumber: order.order_number,
          receiver,
          sender,
          items: items.map(i => ({
            goodsNameCh: i.product_name || '商品',
            goodsNameEn: i.product_name || 'Item',
            price: i.unit_price || 10,
            quantity: i.quantity || 1,
            weight: 100,
            sku: i.sku || '',
          })),
          totalWeight,
          ...dims,
          currency: order.currency || 'USD',
          remark: order.notes || '',
        });
      } else if (carrier === 'equick') {
        const config = deepScanDb.prepare('SELECT * FROM carrier_configs WHERE carrier = ?').get('equick') as any;
        if (!config) return res.status(400).json({ error: 'equick not configured' });
        const extra = JSON.parse(config.extra_config || '{}');
        const { createOrder: equickCreate } = await import('../engine/scripts/carrier-equick');
        result = await equickCreate({
          appKey: config.api_key,
          appSecret: config.api_secret,
          baseUrl: config.api_base_url,
          nonce: 'slnkda',
          version: '1.0',
          hubInCode: extra.hubInCode || 'FED-CJJ',
        }, {
          orderNumber: order.order_number,
          receiver: { ...receiver, countryCode: receiver.country },
          weight: totalWeight,
          ...dims,
          decValue: 10,
          remark: order.notes || '',
        });
      } else {
        return res.status(400).json({ error: 'unknown carrier: ' + carrier });
      }

      if (!result.success) return res.status(400).json({ error: result.message || 'shipment failed' });

      // Save shipment record
      const now = Date.now();
      deepScanDb.prepare(`
        INSERT INTO shipments (order_id, carrier, waybill_number, status, package_length_cm, package_width_cm, package_height_cm, package_weight_g, carrier_response, created_at, updated_at)
        VALUES (?, ?, ?, 'created', ?, ?, ?, ?, ?, ?, ?)
      `).run(order.id, carrier, result.waybillNumber, dims.length, dims.width, dims.height, totalWeight, JSON.stringify(result), now, now);
      deepScanDb.prepare("UPDATE orders SET status='processing', carrier=?, tracking_number=?, box_id=?, updated_at=? WHERE id=?")
        .run(carrier, result.waybillNumber, boxId, now, order.id);

      res.json({ ok: true, waybillNumber: result.waybillNumber, labelUrl: result.labelUrl });
    });

    const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID || '7b5a3625ac60ba058a54ca02d675e47a';
    const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET || '';
    const SHOPIFY_STORE = process.env.SHOPIFY_STORE || 'dptattoo';


    // POST /api/fulfillment/shopify/sync — 拉取 Shopify 订单入库
    app.post('/api/fulfillment/shopify/sync', async (req, res) => {
      try {
        const config = deepScanDb.prepare("SELECT * FROM carrier_configs WHERE carrier='shopify'").get();
        if (!config) return res.status(400).json({ error: 'Shopify not configured, run OAuth first' });
        const token = config.api_key;
        const baseUrl = config.api_base_url || 'https://dptattoo.myshopify.com/admin/api/2024-04';
        const since = req.body?.since || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
        let page = 1; let synced = 0; let hasMore = true;
        while (hasMore) {
          const r = await fetch(baseUrl + '/orders.json?limit=50&created_at_min=' + since + '&page=' + page, {
            headers: { 'X-Shopify-Access-Token': token }
          });
          const data = await r.json();
          const orders = data.orders || [];
          if (orders.length === 0) { hasMore = false; break; }
          const insertOrder = deepScanDb.prepare("INSERT OR IGNORE INTO orders (order_number, source, status, customer_name, customer_email, country, state, city, zip_code, address, phone, currency, notes, created_at, updated_at) VALUES (?, 'shopify', 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
          const insertItem = deepScanDb.prepare('INSERT OR IGNORE INTO order_items (order_id, sku, product_name, quantity, unit_price) VALUES (?, ?, ?, ?, ?)');
          for (const o of orders) {
            const addr = o.shipping_address || o.customer?.default_address || {};
            const now = Date.now();
            const r2 = insertOrder.run(String(o.order_number), o.shipping_address?.name || o.customer?.name || '', o.email || '', addr.country_code || addr.country || '', addr.province || '', addr.city || '', addr.zip || '', addr.address1 || '', addr.phone || '', o.currency || 'USD', o.note || '', new Date(o.created_at).getTime() || now, now);
            if (r2.changes > 0) {
              const orderId = r2.lastInsertRowid;
              for (const item of (o.line_items || [])) {
                insertItem.run(orderId, item.sku || '', item.name || '', item.quantity || 1, Number(item.price) || 0);
              }
              synced++;
            }
          }
          page++;
        }
        res.json({ ok: true, synced: synced, message: 'Synced ' + String(synced) + ' orders' });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    // GET /api/fulfillment/shopify/callback — OAuth 回调，换 token
    app.get('/api/fulfillment/shopify/callback', async (req, res) => {
      const { code, state } = req.query as Record<string, string>;
      if (!code) return res.status(400).send('Missing code');
      try {
        const r = await fetch(`https://${SHOPIFY_STORE}.myshopify.com/admin/oauth/access_token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: SHOPIFY_CLIENT_ID,
            client_secret: SHOPIFY_CLIENT_SECRET,
            code,
            grant_type: 'authorization_code',
          }),
        });
        const data = await r.json() as any;
        const accessToken = data.access_token;
        if (!accessToken) return res.status(400).send('Failed to get token: ' + JSON.stringify(data));

        // 保存到 carrier_configs（shopify 行）
        const now = Date.now();
        deepScanDb.prepare(`
          INSERT INTO carrier_configs (carrier, label, api_base_url, api_key, api_secret, extra_config, enabled, created_at)
          VALUES ('shopify', 'Shopify', ?, ?, '', ?, 1, ?)
          ON CONFLICT(carrier) DO UPDATE SET api_key = excluded.api_key, api_secret = excluded.api_secret, extra_config = excluded.extra_config
        `).run(`https://${SHOPIFY_STORE}.myshopify.com/admin/api/2024-04`, accessToken, JSON.stringify({ scopes: data.scope || '' }), now);

        res.send('✅ Shopify 授权成功！可以关闭此页面。');
      } catch (e: any) {
        res.status(500).send('Error: ' + e.message);
      }
    });

    // ========== Vite dev server middleware ==========
    if (process.env.NODE_ENV !== 'production') {
      const vite = await createViteServer({
        server: {
          middlewareMode: true,
          watch: {
            ignored: [
              '**/data/**',
              '**/data/**/*.db',
              '**/data/**/*.db-*',
              '**/data/**/*.sqlite*',
              '**/data/**/*.wal',
              '**/data/**/*.shm',
              '**/backups/**',
              '**/.cloakbrowser_cache/**'
            ]
          }
        },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } else {
      const distPath = path.join(process.cwd(), 'dist');
      app.use(express.static(distPath));
      app.get('*', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }

    const PORT = 3000;
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('CRITICAL: Failed to start server:', error);
    process.exit(1);
  }
}

startServer().catch(err => {
  console.error('CRITICAL: Unhandled error during startup:', err);
  process.exit(1);
});



