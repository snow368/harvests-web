# InkFlow MVP开发文档

## 1. 系统总览

### 1.1 目标
- 用可控风险的方式完成：纹身店数据抓取 -> 目标筛选 -> Bot互动 -> 关系升温 -> DM转化。

### 1.2 主链路
1. `Scrape State / Python Scanner` 抓取店铺基础数据（店名、地址、网站、IG/FB、评论数等）。
2. 数据进入 `artists`（Neon）并去重更新。
3. `Deep Scan / Bot Observation` 补充社媒与账号画像字段。
4. `generate-from-artists` 生成自动化任务（按 leadScore + followPriority 排队）。
5. Bot worker 执行浏览/点赞/评论/关注策略（按风控规则）。
6. 执行结果回写 `bot_observations` + artists增量字段。
7. 前端 `Artist Analyzer` 展示 live feed、关系映射、人工审核。

### 1.3 关键数据表
- `artists`：主数据。
- `automation_tasks`：任务池。
- `bot_instances`：bot在线状态/暂停状态。
- `bot_observations`：行为与观测日志。
- `review_overrides`：人工 keep/delete 覆盖。
- `content_competitors / content_samples / content_templates`：内容学习与模板库。

---

## 2. 养号策略文档

### 2.1 分阶段策略
1. D1-D2：`browse_only`，不点赞不评论不关注。
2. D3-D4：低量点赞（1-3/访问，日总低量）。
3. D5-D7：点赞+极低频评论（默认关闭，按条件开启）。
4. D8+：高分目标进入关注策略（follow）。

### 2.2 当前已落地执行规则
- 贴内点赞：每次访问 `1-3` 条。
- 点赞间隔：`40-120s` 随机。
- 同账号冷却：`24-72h` 后再点赞。
- 评论：默认关闭，开启后按概率、日上限、同店铺7天冷却。
- 关注：必须先浏览/点赞，且触达次数达标才允许。

### 2.3 波浪型节奏
- 日内随机波动，避免固定行为。
- 周内保留轻量日，禁止满负荷连续运行。
- 出现风险信号（挑战、限制）时自动降级为浏览模式。

---

## 3. 目标评分与队列策略

### 3.1 Lead Score（0-100）
- 评分因子：rating、reviews、IG相关性、website、address 完整度。
- 当前在 `/api/automation/generate-from-artists` 内计算。

### 3.2 Follow Priority 分层
- `high`：优先处理，允许进入 follow 候选。
- `medium`：任务后延 24-48h。
- `low`：任务后延 48-96h。

### 3.3 执行准入
- follow 仅对 `high` 生效。
- 同店铺需满足：
  - 有浏览与点赞行为。
  - 触达次数（touches）达到阈值。
  - 当天 follow 未超随机上限。

### 3.4 人工审核闭环
- 非纹身候选进入 Manual Review。
- `KEEP`：回队列并恢复后续执行资格。
- `DELETE`：删除并阻断后续任务。

---

## 4. 内容策略文档

### 4.1 Brand Profile（必须先建立）
- 产品线：以 `cartridge` 为主。
- 卖点：稳定性、精度、一致性、安全/灭菌、体验反馈。
- 禁用词：过度营销、违规承诺、平台敏感词。
- CTA偏好：soft CTA（DM咨询、看简介、评论讨论）。

### 4.2 竞品学习链路（已接API）
1. 导入竞品 handles：`/api/content/competitors/import-handles`
2. 从 observation 提取样本：`/api/content/samples/ingest-from-observations`
3. 生成7天模板计划：`/api/content/templates/generate`

### 4.3 样本拆解字段
- style tags、topic tag、cta tag、quality score、engagement hint。
- 输出可用于：视频脚本、图文文案、DM开场素材。

### 4.4 视频内容生产（低成本）
- 结构：Hook -> Demo -> Proof -> CTA（15-25秒）。
- 模板化参数替换，批量生成（CapCut/Canva免费流程）。

---

## 5. 风控与异常处理

### 5.1 平台风险信号
- 验证码、挑战页、评论受限、动作被拦截。
- 页面结构异常（点击被遮挡、modal关闭失败）。

### 5.2 自动降级策略
1. 停评论 -> 仅浏览+少量点赞。
2. 停关注 -> 保留浏览。
3. 账号暂停 24-72h 后重试。

### 5.3 运行故障恢复
- 服务异常：先恢复 `npm run dev` 与 `/api/health`。
- CDP异常：重启指定 Chrome profile 与调试端口。
- 任务中断：用 existing task / queue 继续，避免从头跑。

### 5.4 数据一致性
- 观测写回失败不阻塞主流程（best effort）。
- 关键状态（like/comment/follow冷却）落地本地状态文件。

---

## 6. 运营SOP

### 6.1 每日开机流程
1. 启动服务（A窗口）：`npm run dev`
2. 启动CDP浏览器（C窗口）：指定 profile + debug port
3. 启动worker（D窗口）：加载 bot 环境变量后 `npm run bot:worker:real`
4. 检查在线状态：`/api/bot/online`
5. 生成当日任务池：`/api/automation/generate-from-artists`

### 6.2 运行中巡检（每1-2小时）
- Bot是否在线。
- 当前任务是否推进。
- Manual Review 是否堆积。
- 非纹身误判是否上升。

### 6.3 每日收工流程
1. Pause all bots。
2. 导出关键指标（互动、关注、评论、失败原因）。
3. 记录当天异常。
4. 次日计划（配额、内容主题、测试项）。

### 6.4 每周复盘指标
- 回赞率、回关率、评论回复率。
- DM开启率、DM回复率。
- 非纹身误判率。
- 任务完成率与异常中断率。

---

---
## 7. Bot行为画像系统

### 7.1 设计原则
- 每个 bot 有唯一的**确定性行为指纹**，由 bot ID 的 SHA-256 hash 决定
- 同一 bot 始终如一，不同 bot 天生不同
- 重启后参数保持一致，无需额外存储

### 7.2 差异化维度

| 维度 | 范围 | 说明 |
|------|------|------|
| 打字速度 | 40-119ms/键 | 基准按键间隔，hash 决定 |
| 打字抖动 | 15-74ms | 每次按键的随机波动幅度 |
| 走神停顿概率 | 3-12% | 打字中途随机停顿的概率 |
| 停顿时长 | 300-1499ms | 模拟思考/分心的停顿 |
| 错字率 | 1-5% | 模拟人类打错+退格修正 |
| 退格速度 | 80-229ms | 修正错字的退格速度 |
| 浏览速度因子 | 0.8-4.0 | 页面浏览快慢（越大越慢）|
| 日波动幅度 | 0.20-0.55 | 每天速度在基线范围内的随机偏移 |
| 浏览顺序 | random/newest/mixed | 浏览帖子列表的顺序偏好 |
| 休息间隔 | 每3-6个profile | 浏览多少个 profile 后休息 |
| 可见帖子数 | 5-10 | 最少浏览几个帖子才离开 |
| 视窗分辨率 | 1280x900 ~ 1920x1080 | 6种常见分辨率随机分配 |
| 评论风格种子 | 0-9999 | 决定评论模板的选择偏好 |

### 7.3 每日抖动机制
- 同一 bot 每天的 speed factor 在其自然范围内浮动
- 由 `日期 + profile.speedFactorMin` 做 hash 决定当日值
- 确保跨天行为不会完全一致，避免被平台检测

### 7.4 核心文件
- `scripts/bot-profile.ts` — 画像生成、缓存、日抖动计算
- `scripts/bot-worker-cloak.ts` — 已接入画像的 CloakBrowser worker
- `scripts/publish-worker.ts` — 发帖 worker 也使用 per-bot 打字画像

### 7.5 Server API
- `GET /api/bot/online` — 返回 `profile` 字段，包含 typing/browsing/viewport/commentStyleSeed
- 前端可直接展示每个 bot 的行为参数

---
## 8. 内容创作Pipeline

### 8.1 整体流程
```
合作纹身师帖子 → AI视觉评分 → 高评分采集 → DeepSeek文案改写
→ 水印处理 → 人工审核 → 自动发布到IG → 反馈追踪
```

### 8.2 模块拆解

#### 8.2.1 Content Scraper（内容采集）
- 文件：`scripts/content-scraper.ts`
- 输入：`content_competitors` 表中的活跃 handles
- 用 CloakBrowser 逐帖截图 + 提取 caption
- 两套评分系统：
  - **PostQualityScore**（0-100）：产品可见度(35) + 纹身质量(20) + 照片质量(10) + 互动(15) + 文案质量(10) + 新鲜度(10)
  - **PartnerArtistScore**（0-100）：作品质量(40) + 产品出现频率(25) + 活跃度(15) + 互动率(10) + 城市密度(10)
- 输出：`content_samples` 表 + `content-library/products/` 媒体文件
- ENV 关键配置：`CONTENT_SCRAPE_MIN_POST_SCORE=55`, `CONTENT_SCRAPE_POSTS_PER_HANDLE=5`

#### 8.2.2 Content Creator（二次创作）
- 文件：`scripts/content-creator.ts`
- 读取高评分 `content_samples`
- DeepSeek 改写 caption（品牌口吻 + emoji + 300字内）
- DeepSeek 生成 10-15 个 hashtags
- Sharp/FFmpeg 加水印
- 输出：`data/content_review/<id>/` 待审核 + 自动创建 publish 任务（延迟2小时）
- ENV：`DEEPSEEK_API_KEY`, `CONTENT_CREATOR_WATERMARK`, `CONTENT_CREATOR_PUBLISH_BOT`

#### 8.2.3 Publish Worker（自动发帖）
- 文件：`scripts/publish-worker.ts`
- 轮询 `content_publish_tasks` 表（lease/poll 机制）
- CloakBrowser 自动化 IG 发帖流程：打开创建页 → 上传媒体 → 跳过裁剪/滤镜 → 人类化输入 caption → 发布
- Per-bot 打字画像：有停顿、有错字、有退格修正
- 发帖后回调 `/api/publish/report` 更新 `platform_post_id`
- 发帖间隔冷却：5-15分钟随机

### 8.3 内容来源策略

| 来源 | 优先级 | 说明 |
|------|--------|------|
| 合作纹身师帖子 | 最高 | 产品实拍，二次创作后发布，最高转化 |
| 纹身展/展台 | 高 | 展会期间拍照/视频 |
| 客户返图 UGC | 高 | 最高信任度，从 IG/Discord/Email 收集 |
| 产品幕后 | 中 | 生产、质检、包装过程 |
| 教育内容 | 中 | 产品使用教程、纹身后护理 |
| 行业趋势重混 | 低 | Pinterest/Reddit 热门 + 产品关联文案 |

### 8.4 反馈闭环
- 发布后定时拉取 likes/comments/views → `content_engagement` 表
- `content-bot.ts` 的 EMA 权重自动调整：哪类内容表现好就多发

---
## 9. AI视觉纹身质量评估

### 9.1 评分维度（7维度，各0-10分）
| 维度 | 评判内容 |
|------|----------|
| 线条质量 | 干净度、一致性、有无抖动或断裂 |
| 阴影/色彩 | 渐变平滑度、饱和度、色彩均匀度 |
| 构图设计 | 平衡感、比例、身体流动、远距离可读性 |
| 技术执行 | 晕色(blowout)、针深度、皮损程度 |
| 整体美感 | 是否能让人停下来看（scroll-stopping） |
| 产品可见度 | 纹身器材是否被拍到，是否主角 |
| 拍照质量 | 光线、锐度、拍摄角度（评照片不是评纹身）|

### 9.2 多后端支持
| 后端 | 模型 | 费用 | ENV |
|------|------|------|-----|
| Gemini | gemini-2.0-flash | 1500次/天免费 | `GEMINI_API_KEY` |
| 智谱 | glm-4v | 有免费额度 | `GLM_API_KEY` |
| 字节豆包 | doubao-vision-pro-32k | 火山引擎免费额度 | `DOUBAO_API_KEY` |
| DeepSeek | deepseek-chat | ~$0.001/张 | `DEEPSEEK_API_KEY` |
| OpenAI | gpt-4o | ~$0.01/张 | `OPENAI_API_KEY` |

- 自动检测：有哪个 key 用哪个，优先免费后端
- 显式指定：`VISION_BACKEND=gemini`
- 优雅降级：无 API key 时退回关键词+分辨率评分，不影响采集流程
- 跳过开关：`CONTENT_SCRAPE_SKIP_VISION=true`

### 9.3 对评分系统的影响
- PostQualityScore 的 `tattooQuality`（20%）和 `imageAesthetics`（10%）由 AI 视觉决定
- PartnerArtistScore 的 `workQuality`（40%）优先用 AI 视觉聚合分，无数据时退回互动代理分
- 视觉评分结果存入 `content_samples.style_tags_json`，下游可复用

---
## 10. 内容智能工作流

### 10.1 Content Bot（内容策略引擎）
- 文件：`scripts/content-bot.ts` (55K+)
- 6种内容类型生成器
- EMA 权重自动调整（哪类表现好就多发）
- 配合 `tattoo-voice.ts` 行业词库输出品牌一致文案

### 10.2 竞品内容分析
- 文件：`scripts/competitor-content-analyzer.ts`
- 7维度分析引擎：内容类型、风格标签、话题标签、CTA类型、互动指标、发布时间、视觉特征

### 10.3 视频生产
- 文件：`scripts/mixed-slideshow.ts` — FFmpeg 多风格 reel 生成
- 文件：`scripts/video-subtitle-remover.ts` — 视频字幕移除

---
## 版本与执行说明
- 当前版本：MVP v2（养号+评分+Bot画像+内容Pipeline+AI视觉评分）
- 原则：先稳定、后放量；先可控、后自动化。
- 已完成模块：
  1. Bot行为画像系统（支持10-100 bot差异化）
  2. 内容采集→评分→二次创作→自动发布完整链路
  3. AI视觉纹身质量评估（多免费后端）
- 后续优先级：
  1. 跑通端到端内容Pipeline（配置API key + 种子数据）
  2. Dashboard Bot画像展示组件
  3. 转化追踪系统（IG引流→Shopify下单）
  4. DM策略引擎（仅对 warm/hot 目标触发）
