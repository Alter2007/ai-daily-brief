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
├─ github-watch.md  # 只盯 GitHub 仓库动态
└─ chip.md          # 芯片与算力（示例）
```

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
- [ ] M2 本地面板接真实数据、一键运行
- [ ] M3 主题切换 + 信源扩容（政策 / 研究机构 / arXiv）
- [ ] M4 GitHub 单站专题
- [ ] M5 跨天去重 + 重要性打分
- [ ] M6 桌面壳（可选，需 Electron）

## 边界

- **不自动对外发布**。推送需要你自己填 webhook 密钥，一次性 POST。
- **定时靠宿主机在线**。agent 模式下关闭应用就不会跑；code 模式请用系统 cron 或容器定时。
- **不碰个人微信的非官方接口**。

## License

MIT
