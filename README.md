# 每日 AI 简报助手 · ai-daily-brief

> 每天早上 08:00，把最近几天散在几十个网站上的 AI 动态，压成一条能直接发进微信的简报。
> 零依赖、零安装、换主题不用改代码。删掉目录就等于卸载。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)
[![deps](https://img.shields.io/badge/dependencies-0-success.svg)](#)

---

## 它解决什么问题

信息不缺，缺的是**压缩**。你要的不是再来一个信息流，是一条读完就够的简报：

- 每天 08:00 出，覆盖最近 3 天（不是 24 小时，周末不空窗）
- 最多 5 条，每条写清：发生了什么 / 为什么重要 / 谁该看 / 原文链接
- 同一件事的多篇报道并成一条，7 天内不重复
- 换成你关心的主题（AI 行业、AI 编程、某家公司的 release…）
- 也能只盯一个站点（比如 GitHub 上指定仓库的 release）

## 两种跑法

| 模式 | 谁在干活 | 需要什么 | 适合 |
|---|---|---|---|
| **code** | `src/run.mjs` 直接抓 RSS / GitHub API / arXiv | 只要 Node ≥ 18 | 定时、无人值守 |
| **agent** | 任意带工具的大模型（Claude Code / Codex / DeepSeek Harness） | 一个能联网的 agent | 需要读 JS 页面、需要判断和写作 |

code 模式负责**结构化、可重复**的部分；agent 模式负责**需要理解**的部分。两个模式共用同一套 `config/` 和 `prompts/`。

## 快速开始

```bash
git clone https://github.com/<your-name>/ai-daily-brief.git
cd ai-daily-brief

# 用示例数据跑一遍，不联网也能看到输出长什么样
node src/run.mjs --topic ai-industry --dry-run

# 真跑（最近 3 天，GitHub + RSS 源）
node src/run.mjs --topic ai-industry --days 3
```

输出在 `output/YYYY-MM-DD-<topic>-wechat.md`，运行记录在 `logs/YYYY-MM-DD.jsonl`。

## 面板（可选，零依赖）

```bash
node src/serve.mjs            # 真实抓取，监听 127.0.0.1:4177
node src/serve.mjs --dry-run  # 离线演示，用 fixtures 数据
```

打开 <http://127.0.0.1:4177> 就是那个三栏界面：左侧导航、中间条目、底部运行记录。点「立即运行」会真的跑一次流水线并刷新列表。

| 接口 | 说明 |
|---|---|
| `GET /api/state` | 配置、主题列表、信源、最近 20 次运行、最新简报 |
| `POST /api/run` | 触发一次运行，body 可传 `{ "topic": "...", "days": 3, "dryRun": false }` |

服务只监听回环地址，不对外暴露；Ctrl+C 即停，不留后台进程。

### 实测

一次真实运行（2026-10-24，窗口 3 天）：

```
信源   7 试 / 3 成（OpenAI News、Google AI Blog、arXiv 可用；GitHub 三源与 HuggingFace 失败）
候选   5 条过门槛全部采用
耗时   1.5 s
```

失败的源不会让整次运行失败，只记进 `sources_failed`。

## 测试

```bash
npm test          # 等价于 node test/core.test.mjs
```

15 个用例，覆盖：HTML 实体清洗、RSS/Atom 解析、主题规则解析、信源范围过滤、打分回归（零命中挡在门外 / 传闻降权 / 陈旧不加分）、去重指纹、dry-run 端到端。

> 注：在受限沙箱里 `node --test` 会因无法 spawn 子进程而失败，所以 `npm test` 直接跑测试文件（in-process），两边都能用。

## 常用参数

| 参数 | 说明 |
|---|---|
| `--topic <name>` | 用 `config/topics/<name>.md` 这套主题规则，默认 `ai-industry` |
| `--days <n>` | 覆盖配置里的窗口天数，默认取 `config/app.json` 的 `window_days` |
| `--max <n>` | 最多几条，默认 5 |
| `--source <name>` | 只跑某些信源：`github` / `rss` / `arxiv`，可逗号分隔 |
| `--dry-run` | 用 `fixtures/` 里的样例数据跑，不联网 |
| `--out <path>` | 指定输出文件 |

## 换主题 = 换一个文件

`config/topics/ai-industry.md` 定义了这个主题关心什么、怎么分类、怎么筛。换主题就是换文件：

```
config/topics/
├─ ai-industry.md   # 行业动态（默认）
├─ ai-coding.md     # 编程 / 开发者工具
├─ research.md      # 研究前沿（论文 / 机构报告）
└─ github-watch.md  # 只盯 GitHub 仓库 release
```

主题文件里还能锁定信源范围：

```markdown
## 信源
include: vendor, research, policy, media
exclude: arxiv, repo
```

`include` / `exclude` 按信源的 `id`、`category`、`type` 三者任意匹配。所以 `ai-industry` 不会混进 arXiv 论文，`github-watch` 也不会混进新闻。

## 信源（已逐个实测）

不靠印象写配置，`scripts/probe-feeds.mjs` 会告诉你哪些真的能用：

```bash
node scripts/probe-feeds.mjs --from config/sources/rss.json
node scripts/probe-feeds.mjs https://example.com/feed.xml
```

2026-10-24 实测 12 个候选，9 个可用：

| 类别 | 信源 | 状态 |
|---|---|---|
| 厂商 | OpenAI News（RSS，1318 条） | ✅ |
| 厂商 | Google AI Blog | ✅ |
| 厂商 | Anthropic News | ❌ 无 RSS（404），留 `type: web` 给 agent |
| 研究 | Google DeepMind Blog（100 条） | ✅ |
| 研究 | MIT News AI（50 条） | ✅ |
| 政策 | NIST News（40 条，美国政府/标准机构） | ✅ |
| 媒体 | TechCrunch AI / The Verge AI / MIT Tech Review | ✅ |
| 中文 | InfoQ 中文 | ✅ |
| 社区 | Hacker News · AI | ✅ |
| 论文 | arXiv cs.AI / cs.CL | ✅ |
| — | HuggingFace Blog / 36氪 | ❌ 前者连不通，后者返回 HTML 不是 feed |

## 扩信源 = 加一行配置

```jsonc
// config/sources/rss.json
{
  "sources": [
    { "id": "google-ai", "type": "rss", "url": "https://blog.google/technology/ai/rss/", "level": "first-party" }
  ]
}
```

支持的 `type`：`rss`（RSS / Atom 通用）、`github`（releases / commits）、`arxiv`（论文列表）。
没有 feed 的站点归 agent 模式，用 `read_page` 读，配置里 `type: "web"` 标注即可。

## 目录

```
config/          app.json、topics/、sources/
src/             run.mjs、sources/、lib/       ← 零依赖 Node
prompts/         EXPERT.md（agent 模式的人格与规则）
fixtures/        离线样例数据，跑 --dry-run 用
docs/            ARCHITECTURE.md、ROADMAP.md
web/             本地面板（可选，单文件 HTML）
output/ logs/    产物（已 gitignore）
```

## 路线图

见 [docs/ROADMAP.md](docs/ROADMAP.md)。当前进度：

- [x] M1 仓库骨架 + 配置驱动 + code 模式跑通
- [x] M2 本地面板接真实数据、一键运行
- [x] M3 主题切换 + 信源扩容（11 个实测可用源，含政府与研究机构）
- [ ] M4 GitHub 单站专题（代码已通，待联网验证）
- [ ] M5 跨天去重 + 重要性打分打磨
- [ ] M6 桌面壳（可选，需 Electron）

## 边界

- **不自动对外发布**。推送需要你自己填 webhook 密钥，一次性 POST。
- **定时靠宿主机在线**。agent 模式下关闭应用就不会跑；code 模式请用系统 cron 或容器定时。
- **不碰个人微信的非官方接口**。

## License

MIT
