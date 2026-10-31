// src/pipeline.mjs —— 可复用的执行核心。CLI 与面板共用，避免两套实现。
import { readFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import {
  readJson, writeText, parseTopic, score, fingerprint, loadSeen,
  renderWechat, renderMd, pickTag, sourceAllowed, selectItems, ymd, stripBom,
  recentSnapshots, isWeakSummary, splitQuery, filterByQuery,
} from './lib.mjs';
import { COLLECTORS } from './sources.mjs';
import { resolveKey, enrich } from './llm.mjs';

/**
 * 跑一次完整流程。
 * @returns {Promise<{ok:boolean, meta:object, items:object[], failures:object[], stats:object, paths:object}>}
 */
export async function runOnce(opts = {}) {
  const root = resolve(opts.root || process.cwd());
  const app = await readJson(join(root, 'config/app.json'));

  const topic = opts.topic || app.default_topic;
  const days = Number(opts.days ?? app.window_days);
  const maxItems = Number(opts.max ?? app.max_items);
  const minScore = Number(opts.minScore ?? app.min_score);
  const dryRun = !!opts.dryRun;
  const onlySources = (opts.onlySources || []).filter(Boolean);

  const topicMd = stripBom(await readFile(join(root, 'config/topics', topic + '.md'), 'utf8'));
  const topicRules = parseTopic(topicMd);
  const topicTitle = (topicMd.match(/^#\s+主题[:：]\s*(.+)$/m) || [])[1] || topic;

  /* ---- 抓取 ---- */
  const t0 = Date.now();
  const jobs = [];
  for (const rel of app.sources || []) {
    const cfgPath = join(root, rel);
    if (!existsSync(cfgPath)) continue;
    const cfg = await readJson(cfgPath);
    // 主题限定信源范围：include / exclude 按 id / category / type 匹配
    if (Array.isArray(cfg.sources)) {
      cfg.sources = cfg.sources.filter((s) => sourceAllowed(s, topicRules.filter));
    }
    if (dryRun && Array.isArray(cfg.sources)) cfg.sources = cfg.sources.slice(0, 1);
    const types = new Set((cfg.sources || []).map((s) => s.type));
    for (const t of types) {
      if (onlySources.length && !onlySources.includes(t)) continue;
      const collector = COLLECTORS[t];
      if (collector) jobs.push(collector(cfg, { dryRun, root }));
    }
  }

  const results = await Promise.all(jobs);
  const items = [];
  const failures = [];
  let tried = 0;
  let okSources = 0;
  for (const r of results) {
    items.push(...r.items);
    failures.push(...r.failures);
    tried += r.tried;
    okSources += r.ok;
  }

  // 单源截断：有些源一次给上千条（OpenAI 1318 条），按时间倒序只留前 N
  const cap = Number(app.max_items_per_source ?? 40);
  const bySource = new Map();
  for (const it of items) {
    const key = it.source || 'unknown';
    if (!bySource.has(key)) bySource.set(key, []);
    bySource.get(key).push(it);
  }
  const bounded = [];
  for (const [, list] of bySource) {
    list.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    bounded.push(...list.slice(0, cap));
  }
  items.length = 0;
  items.push(...bounded);

  /* ---- 过滤 / 打分 / 去重 ---- */
  const cutoff = Date.now() - days * 86400000;
  const seenPath = join(root, 'seen.json');
  const seen = dryRun ? {} : await loadSeen(seenPath, app.dedupe_days || 7);

  // 同一天重跑不应该越跑越少：今天已记录的不算"已报过"，否则重跑会把当天的池子吃掉
  if (!dryRun) {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    for (const [fp, ts] of Object.entries(seen)) {
      if (ts >= dayStart.getTime()) delete seen[fp];
    }
  }

  const filtered = items.filter((it) => {
    if (dryRun) return true;
    const t = it.date ? Date.parse(it.date) : NaN;
    return Number.isFinite(t) ? t >= cutoff : true;
  });

  // 关键词搜索：给了 query 就只在标题/摘要里匹配到词的条目中挑选
  const queryTerms = splitQuery(opts.query);
  const searched = filterByQuery(filtered, queryTerms);

  const { scored, picked, skipped } = selectItems(searched, {
    seen,
    maxItems,
    minScore,
    topic: topicRules,
  });

  /* ---- 可选：用 DeepSeek 写「为什么重要 / 谁该看」---- */
  const llm = { used: false, ok: false, model: null, ms: 0, note: '' };
  if (picked.length && opts.llm !== false) {
    const k = await resolveKey(root);
    if (!k) {
      llm.note = '未配置 key，使用原文摘要';
    } else {
      llm.used = true;
      llm.keyFrom = k.from;
      try {
        const out = await enrich(picked, k.key, { model: opts.model });
        if (out) {
          picked.length = 0;
          picked.push(...out.items);
          llm.ok = true;
          llm.model = out.model;
          llm.ms = out.ms;
          llm.usage = out.usage;
        }
      } catch (e) {
        llm.note = '调用失败：' + String(e.message || e).slice(0, 120);
      }
    }
  }

  /* ---- 渲染 ---- */
  const meta = {
    date: new Date(),
    windowDays: days,
    topicName: topicTitle,
    topic,
    audience: topicRules.audience,
    tried,
    ok: okSources,
    failed: failures.length,
    maxItems,
    minScore,
    llmOk: llm.ok,
    llmModel: llm.model,
    query: queryTerms.join(' ') || null,
  };

  // 本地日期：toISOString 是 UTC，早于 08:00 会把文件名写成前一天
  const stamp = ymd(meta.date);
  // 搜索模式单独命名，避免覆盖当天的常规简报
  const slug = queryTerms.length
    ? '-q-' + queryTerms.join('_').replace(/[^\w\u4e00-\u9fa5-]/g, '').slice(0, 24)
    : '';
  const defaultName = dryRun ? `_dryrun-${topic}${slug}-wechat.md` : `${stamp}-${topic}${slug}-wechat.md`;
  const wechatPath = opts.outPath
    ? (opts.outPath.startsWith(root) ? opts.outPath : join(root, opts.outPath))
    : join(root, app.output?.dir || 'output', defaultName);
  const mdPath = wechatPath.replace(/-wechat\.md$/, '.md');
  const jsonPath = wechatPath.replace(/-wechat\.md$/, '.json');

  // 今日无新增时给「回顾」，避免安静日交白卷（回顾条目不会被写进去重表之外的东西）
  let recall = [];
  if (!picked.length && !dryRun) {
    const snaps = await recentSnapshots(join(root, app.output?.dir || 'output'), {
      excludeStem: `${stamp}-${topic}`,
      suffix: `-${topic}.json`,
      limit: 3,
    });
    const pool = [];
    for (const s of snaps) {
      for (const it of s.items || []) {
        // 摘要太短的（比如只剩「点击查看原文」）不适合当回顾
        if ((it.why || it.summary || '').length < 12) continue;
        pool.push({ ...it, recall: true });
      }
    }
    const uniq = [];
    const seenFp = new Set();
    for (const it of pool.sort((a, b) => (b.score || 0) - (a.score || 0))) {
      const fp = fingerprint(it);
      if (seenFp.has(fp)) continue;
      seenFp.add(fp);
      uniq.push(it);
      if (uniq.length >= 2) break;
    }
    recall = uniq;
  }
  const emitted = picked.length ? picked : recall;
  const metaOut = { ...meta, recall: !picked.length && recall.length > 0, recallCount: recall.length };

  const wechat = emitted.length
    ? renderWechat(emitted, metaOut)
    : `【AI 日报 ${stamp.slice(5)}】今日无重要更新。\n\n— 本次运行：信源 ${tried} 试 ${okSources} 成，失败 ${failures.length} 个；没有达到筛选标准的内容，也不凑数。\n`;

  if (!dryRun && existsSync(wechatPath)) {
    await writeText(join(root, 'archive/.keep'), '');
    await rename(wechatPath, join(dirname(wechatPath), '..', 'archive', `${stamp}-${topic}-wechat.prev.md`)).catch(() => {});
  }

  await writeText(wechatPath, wechat);
  await writeText(mdPath, renderMd(emitted, metaOut));
  await writeText(jsonPath, JSON.stringify({ meta: metaOut, items: emitted }, null, 2));

  /* ---- 去重表 & 日志 ---- */
  if (!dryRun) {
    for (const it of picked) seen[fingerprint(it)] = Date.now();
    await writeText(seenPath, JSON.stringify(seen, null, 2));
  }

  const duration = Date.now() - t0;
  const allFailed = tried > 0 && okSources === 0;
  const status = allFailed
    ? 'all_sources_failed'
    : failures.length
      ? picked.length
        ? 'ok_with_source_failure'
        : 'empty'
      : 'ok';

  const entry = {
    run_id: `${stamp}-${topic}`,
    trigger: opts.trigger || (dryRun ? 'dry-run' : 'manual'),
    topic,
    window_days: days,
    sources_tried: tried,
    sources_ok: okSources,
    sources_failed: failures,
    candidates: items.length,
    scored_pass: scored.length,
    items_kept: picked.length,
    skipped_duplicates: skipped.length,
    recall_items: recall.length,
    weak_summary_items: picked.filter((it) => isWeakSummary(it.summary)).length,
    query: queryTerms.join(' ') || null,
    query_matched: queryTerms.length ? searched.length : null,
    min_score: minScore,
    duration_ms: duration,
    output: wechatPath,
    llm: { used: llm.used, ok: llm.ok, model: llm.model, ms: llm.ms, note: llm.note || undefined },
    status,
  };
  if (!dryRun) {
    await writeText(join(root, app.logging?.dir || 'logs', `${stamp}.jsonl`), JSON.stringify(entry) + '\n');
    // 全部信源挂掉时留一个显眼的失败标记，别让定时任务静默失败
    if (allFailed) {
      await writeText(
        join(root, app.logging?.dir || 'logs', `_failed-${stamp}.json`),
        JSON.stringify({ stamp, ranAt: new Date().toISOString(), tried, failures }, null, 2),
      );
    }
  }

  return {
    ok: !allFailed,
    status,
    meta,
    items: picked,
    failures,
    llm,
    stats: { tried, okSources, candidates: items.length, scoredPass: scored.length, kept: picked.length, duration },
    paths: { wechat: wechatPath, md: mdPath, json: jsonPath },
    log: entry,
  };
}
