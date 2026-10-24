# ROADMAP

按"先让它真、再让它好、最后让它像产品"的顺序推进。

## M1 · 仓库骨架 + 配置驱动（已完成）

- [x] MIT / README / .gitignore
- [x] `config/app.json`：时间、窗口天数、条数、分数门槛
- [x] `config/topics/*.md`：主题即文件，换主题不改代码
- [x] `config/sources/*.json`：rss / github / arxiv 三类适配器
- [x] `node src/run.mjs --dry-run` 离线可跑（fixtures）
- [x] 打分、跨源去重、分类、日志、归档

验收：`node src/run.mjs --topic ai-industry --dry-run` 输出 5 条，`--topic github-watch --source github` 输出 release 专项。

## M2 · 本地面板接真实数据（下一步）

- [ ] `src/serve.mjs`：本地 HTTP 服务，暴露 `/api/brief`、`/api/runs`、`/api/run`
- [ ] `web/index.html` 改为 fetch 真实数据，带运行按钮与进度
- [ ] 面板与 CLI 共用同一份 `config/`

验收：面板上点"立即运行"，30 秒内列表刷新为新结果。

## M3 · 主题与信源扩容

- [ ] 主题：`ai-coding` / `github-watch` 之外，补 `chip`、`policy`
- [ ] 信源：政策与监管公告（RSS）、研究机构博客、arXiv 分类可配
- [ ] `type: "web"` 交给 agent 模式补抓，配置里明示

验收：`--topic policy` 能出 3 条以上有效条目。

## M4 · GitHub 单站专题打磨

- [ ] 支持 `kind: commits`（过滤 merge/chore）
- [ ] 支持组织级 watch（`org: openai`）
- [ ] release 正文里提取 breaking change
- [ ] `GITHUB_TOKEN` 支持与速率提示

验收：`--topic github-watch` 能覆盖 10 个仓库，未鉴权时不报错降级。

## M5 · 质量层

- [ ] 跨天去重（`seen.json` 已有雏形，补 7 天窗口验证）
- [ ] 重要性打分可调（主题里写权重）
- [ ] 人工反馈：`feedback.jsonl` + `--learn` 重排
- [ ] 空结果与全源失败两条路径的自动化测试

验收：`npm test`（无依赖，用 `node --test`）全绿。

## M6 · 桌面壳（可选）

- [ ] 托盘 + 一键运行
- [ ] 开机不自启（原则）
- [ ] 打包：Electron 或 Tauri（**需要安装依赖，破坏零安装，需用户显式同意**）

验收：双击图标 → 面板 → 点运行 → 出简报。

## 不做

- 多智能体编排
- 对话式问答界面
- 全平台推送（先做稳一个渠道）
