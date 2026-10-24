# 架构

## 一句话

配置驱动 + 适配器抓取 + 规则打分 + 模板渲染。需要"理解"的部分交给 agent，其余交给代码。

## 数据流

```
config/app.json ──┐
config/topics/x.md├─→ run.mjs ─→ sources/*（rss | github | arxiv）
config/sources/*.json ┘              │
                                    ├─→ 窗口过滤（最近 N 天）
                                    ├─→ 打分（关键词 + 一手源 + 新鲜度 − 传闻）
                                    ├─→ 去重（跨源 + seen.json 跨天）
                                    ├─→ 取前 N 条
                                    └─→ 渲染 → output/*.md  +  logs/*.jsonl
```

## 三种模式

| 模式 | 入口 | 谁做判断 |
|---|---|---|
| code | `node src/run.mjs` | 规则（关键词打分） |
| agent | 任意带工具的 LLM 读 `prompts/EXPERT.md` | 模型 |
| hybrid | 代码先抓，agent 再润色/补网页源 | 各管一段 |

`type: "web"` 的信源在 code 模式被跳过——它们没有 feed，需要渲染或理解，属于 agent 的活。

## 关键数据结构

条目（item）：

```js
{ title, url, date /* ISO */, summary, org, level: 'first-party'|'second-hand', source, score, tags }
```

运行日志（`logs/YYYY-MM-DD.jsonl`）：

```json
{ "run_id":"2026-10-24-ai-industry", "trigger":"manual", "topic":"ai-industry",
  "window_days":3, "sources_tried":4, "sources_ok":2,
  "sources_failed":[{"source":"openai-news","error":"HTTP 403"}],
  "candidates":16, "scored_pass":5, "items_kept":5, "duration_ms":38014,
  "status":"ok_with_source_failure" }
```

## 打分公式

```
score = base（默认 10）
      + min(命中加分词 × per_hit, hit_cap)      默认 10 / 30
      + zero_hit_penalty（一个词都没命中）        默认 −10
      + negative_penalty × 命中的减分词           默认 −25
      + first_party（一手源）                     默认 15
      + fresh_1d / fresh_3d（≤1 天 / ≤3 天）      默认 10 / 5
低于 min_score（默认 40）不进简报。
```

所有权重都能在主题文件里覆盖，不用改代码：

```markdown
## 权重
zero_hit_penalty: 0
first_party: 20
```

## 去重

- 同一次运行内：标题归一化（去标点、转小写）取 sha1 前 16 位
- 跨天：`seen.json` 记录指纹与时间戳，`dedupe_days`（默认 7）内不再重复
- 实证：同一天连跑两次，第二次采用 4 条，与第一次的 5 条**零重叠**——
  去重表里的条目被跳过，剩下的候选按分数递补

> 注意语义：去重保证的是"不重复报同一件事"，不是"重跑就输出空"。
> 同一天重跑会拿到上一轮没来得及报的次优条目。想避免就在 `seen.json` 里手动清空前一天的记录。

## 失败处理

单源失败 → 记进 `sources_failed` 继续；全部失败 → `status: "empty"` 且输出「今日无重要更新」。
不重试轰炸，不静默跳过。

## 扩展一个新信源

1. 在 `config/sources/*.json` 加一条（`type` 选 `rss`/`github`/`arxiv`）
2. 若是新类型：在 `src/sources.mjs` 写一个 `collectXxx(cfg, opts)`，返回 `{items, failures, tried, ok}`，注册进 `COLLECTORS`
3. `--dry-run` 加一份 `fixtures/` 样例，保证离线可测
