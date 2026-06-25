/**
 * Backlink API Routes — 外链自动化后台 API
 *
 * 在 server.ts 中添加：
 *   import backlinkRouter from './src/lib/backlink-api.ts';
 *   app.use('/api/backlinks', backlinkRouter);
 */

import { Router } from 'express';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';
import { spawn } from 'child_process';

const router = Router();

// ── 路径 ──
const BASE_DIR = 'F:/SEO_Project';
const DATA_DIR = path.join(BASE_DIR, 'data');
const DB_PATH = path.join(BASE_DIR, 'data/backlinks.db');
const ENGINE_DIR = 'F:/inkflow app/InkFlow_Project/harvests-engine';
const SCRIPTS_DIR = path.join(ENGINE_DIR, 'scripts');

// ── DB 连接（函数式，避免模块初始化时锁定）─
function getDb() {
  return new Database(DB_PATH);
}

// ── 工具函数 ──
function loadYaml(filePath: string): any {
  if (!fs.existsSync(filePath)) return {};
  return yaml.load(fs.readFileSync(filePath, 'utf-8')) || {};
}

function runScript(scriptName: string, args: string[] = []): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', `scripts/${scriptName}`, ...args], {
      cwd: ENGINE_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });
    let output = '';
    child.stdout.on('data', (data: Buffer) => { output += data.toString(); });
    child.stderr.on('data', (data: Buffer) => { output += data.toString(); });
    child.on('close', (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`Exit code ${code}: ${output}`));
    });
    child.on('error', reject);
    // 超时 120s
    setTimeout(() => { child.kill(); reject(new Error('Timeout')); }, 120_000);
  });
}

// ═══════════════════════════════════════════
//  API 路由
// ═══════════════════════════════════════════

// ── 获取汇总统计 ──
router.get('/stats', (req, res) => {
  try {
    const db = getDb();
    const allPlatforms = loadYaml(path.join(DATA_DIR, 'backlink-platforms.yaml'));
    const platformCount = Object.keys(allPlatforms?.platforms || {}).length;

    const totalTasks = (db.prepare('SELECT COUNT(*) as c FROM submission_tasks').get() as any)?.c || 0;
    const pendingTasks = (db.prepare("SELECT COUNT(*) as c FROM submission_tasks WHERE status = 'pending'").get() as any)?.c || 0;
    const runningTasks = (db.prepare("SELECT COUNT(*) as c FROM submission_tasks WHERE status = 'running'").get() as any)?.c || 0;
    const doneTasks = (db.prepare("SELECT COUNT(*) as c FROM submission_tasks WHERE status = 'done'").get() as any)?.c || 0;

    const totalSubmissions = (db.prepare('SELECT COUNT(*) as c FROM backlink_submissions').get() as any)?.c || 0;
    const successSubmissions = (db.prepare("SELECT COUNT(*) as c FROM backlink_submissions WHERE status IN ('success','pending_review')").get() as any)?.c || 0;
    const paywallCount = (db.prepare("SELECT COUNT(*) as c FROM backlink_submissions WHERE status = 'paywall'").get() as any)?.c || 0;
    const captchaCount = (db.prepare("SELECT COUNT(*) as c FROM backlink_submissions WHERE status = 'captcha'").get() as any)?.c || 0;

    const totalAssets = (db.prepare("SELECT COUNT(*) as c FROM backlink_assets WHERE status = 'active'").get() as any)?.c || 0;
    const indexedAssets = (db.prepare("SELECT COUNT(*) as c FROM backlink_assets WHERE status = 'active' AND last_checked IS NOT NULL").get() as any)?.c || 0;

    db.close();

    res.json({
      ok: true,
      stats: {
        platforms: platformCount,
        tasks: { total: totalTasks, pending: pendingTasks, running: runningTasks, done: doneTasks },
        submissions: { total: totalSubmissions, success: successSubmissions, paywall: paywallCount, captcha: captchaCount },
        assets: { total: totalAssets, indexed: indexedAssets },
      }
    });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── 按项目获取详细信息 ──
router.get('/projects', (req, res) => {
  try {
    const projects = loadYaml(path.join(DATA_DIR, 'project-configs.yaml'));
    const db = getDb();

    const result: any[] = [];
    for (const [id, proj] of Object.entries(projects?.projects || {})) {
      if (id.startsWith('_')) continue;
      const p = proj as any;
      const tasks = (db.prepare('SELECT COUNT(*) as c FROM submission_tasks WHERE project_id = ?').get(id) as any)?.c || 0;
      const pending = (db.prepare("SELECT COUNT(*) as c FROM submission_tasks WHERE project_id = ? AND status = 'pending'").get(id) as any)?.c || 0;
      const submitted = (db.prepare('SELECT COUNT(*) as c FROM backlink_submissions WHERE project_id = ?').get(id) as any)?.c || 0;
      const success = (db.prepare("SELECT COUNT(*) as c FROM backlink_submissions WHERE project_id = ? AND status IN ('success','pending_review')").get(id) as any)?.c || 0;
      const assets = (db.prepare("SELECT COUNT(*) as c FROM backlink_assets WHERE project_id = ? AND status = 'active'").get(id) as any)?.c || 0;

      result.push({
        id,
        name: p.name,
        domain: p.domain,
        industry: p.industry,
        priority: p.priority,
        dailyQuota: p.daily_quota,
        stats: { tasks, pending, submitted, success, assets },
      });
    }

    db.close();
    res.json({ ok: true, projects: result });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── 获取提交记录 ──
router.get('/submissions', (req, res) => {
  try {
    const db = getDb();
    const projectId = req.query.project as string;
    const limit = parseInt(req.query.limit as string || '50', 10);
    const offset = parseInt(req.query.offset as string || '0', 10);

    let query = 'SELECT * FROM backlink_submissions';
    const params: any[] = [];
    if (projectId) {
      query += ' WHERE project_id = ?';
      params.push(projectId);
    }
    query += ' ORDER BY submitted_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = db.prepare(query).all(...params);
    const total = (db.prepare('SELECT COUNT(*) as c FROM backlink_submissions').get() as any)?.c || 0;

    db.close();
    res.json({ ok: true, submissions: rows, total });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── 获取待执行任务 ──
router.get('/tasks', (req, res) => {
  try {
    const db = getDb();
    const projectId = req.query.project as string;
    const status = req.query.status as string || 'pending';

    let query = 'SELECT st.*, p.name as platform_name FROM submission_tasks st';
    const params: any[] = [];

    const conditions: string[] = [];
    if (projectId) {
      conditions.push('st.project_id = ?');
      params.push(projectId);
    }
    if (status !== 'all') {
      conditions.push('st.status = ?');
      params.push(status);
    }
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY st.priority ASC, st.created_at ASC LIMIT 100';

    const rows = db.prepare(query).all(...params);

    // 补充平台名称（从 yaml 取）
    const platforms = loadYaml(path.join(DATA_DIR, 'backlink-platforms.yaml'))?.platforms || {};
    const enriched = rows.map((r: any) => ({
      ...r,
      platform_name: platforms[r.platform_id]?.name || r.platform_id,
      platform_dr: platforms[r.platform_id]?.dr || 0,
      platform_difficulty: platforms[r.platform_id]?.difficulty || 'unknown',
    }));

    db.close();
    res.json({ ok: true, tasks: enriched });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── 获取外链资产库 ──
router.get('/assets', (req, res) => {
  try {
    const db = getDb();
    const projectId = req.query.project as string;
    const limit = parseInt(req.query.limit as string || '100', 10);

    let query = 'SELECT * FROM backlink_assets WHERE status = ?';
    const params: any[] = ['active'];
    if (projectId) {
      query += ' AND project_id = ?';
      params.push(projectId);
    }
    query += ' ORDER BY dr DESC LIMIT ?';
    params.push(limit);

    const rows = db.prepare(query).all(...params);
    db.close();
    res.json({ ok: true, assets: rows });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── 获取平台列表 ──
router.get('/platforms', (req, res) => {
  try {
    const allPlatforms = loadYaml(path.join(DATA_DIR, 'backlink-platforms.yaml'));
    const platforms = allPlatforms?.platforms || {};
    const list = Object.entries(platforms).map(([key, p]: [string, any]) => ({
      key,
      name: p.name,
      url: p.url,
      type: p.type,
      dr: p.dr,
      difficulty: p.difficulty,
      registration: p.registration,
      paywall: p.paywall,
      captcha: p.captcha,
      approval: p.approval,
      suitableFor: p.suitable_for,
    }));
    res.json({ ok: true, platforms: list });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── 行动：生成任务 ──
router.post('/action/schedule', async (req, res) => {
  try {
    const output = await runScript('backlink-scheduler.ts', []);
    res.json({ ok: true, output: output.split('\n').filter(l => l.trim()) });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── 行动：执行提交（异步） ──
router.post('/action/execute', async (req, res) => {
  try {
    const project = req.body?.project || '';
    const args = project ? ['--project=' + project] : [];
    // 异步执行，不等待完成
    runScript('backlink-worker.ts', args).catch(() => {});
    res.json({ ok: true, message: 'Worker started' });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── 行动：巡检 ──
router.post('/action/check', async (req, res) => {
  try {
    const args = ['--quick'];
    const output = await runScript('backlink-tracker.ts', args);
    res.json({ ok: true, output: output.split('\n').filter(l => l.trim()) });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── 获取运行日志 ──
router.get('/logs', (req, res) => {
  try {
    const LOGS_DIR = path.join(ENGINE_DIR, '..', 'logs');
    const logFile = path.join(LOGS_DIR, 'backlink-worker-out.log');
    if (!fs.existsSync(logFile)) {
      return res.json({ ok: true, logs: [] });
    }
    const content = fs.readFileSync(logFile, 'utf-8');
    const lines = content.split('\n').filter(Boolean).slice(-50);
    res.json({ ok: true, logs: lines });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
