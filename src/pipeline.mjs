// src/pipeline.mjs —— 可复用的执行核心。CLI 与面板共用，避免两套实现。
import { readFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import {
  readJson, writeText, parseTopic, score, fingerprint, loadSeen,
  renderWechat, renderMd, pickTag,
} from './lib.mjs';
import { COLLECTORS } from './sources.mjs';

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

  const topicMd = await readFile(join(root, 'config/topics', topic + '.md'), 'utf8');
  const topicRules = parseTopic(topicMd);
  const topicTitle = (topicMd.match(/^#\s+主题[:：]\s*(.+)$/m) || [])[1] || topic;

  /* ---- 抓取 ---- */
  const t0 = Date.now();
  const jobs = [];
  for (const rel of app.sources || []) {
    const cfgPath = join(root, rel);
    if (!existsSync(cfgPath)) continue;
    const cfg = await readJson(cfgPath);
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

  /* ---- 过滤 / 打分 / 去重 ---- */
  const cutoff = Date.now() - days * 86400000;
  const seenPath = join(root, 'seen.json');
  const seen = dryRun ? {} : await loadSeen(seenPath, app.dedupe_days || 7);

  const scored = items
    .filter((it) => {
      if (dryRun) return true;
      const t = it.date ? Date.parse(it.date) : NaN;
      return Number.isFinite(t) ? t >= cutoff : true;
    })
    .map((it) => ({
      ...it,
      score: score(it, topicRules),
      tags: [String(it.source || '').startsWith('arxiv') ? '技术' : pickTag(it)],
    }))
    .filter((it) => it.score >= minScore)
    .sort((a, b) => b.score - a.score || String(b.date).localeCompare(String(a.date)));

  const picked = [];
  const seenNow = new Set();
  for (const it of scored) {
    const fp = fingerprint(it);
    if (seen[fp] || seenNow.has(fp)) continue;
    seenNow.add(fp);
    picked.push(it);
    if (picked.length >= maxItems) break;
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
  };

  const stamp = meta.date.toISOString().slice(0, 10);
  const defaultName = dryRun ? `_dryrun-${topic}-wechat.md` : `${stamp}-${topic}-wechat.md`;
  const wechatPath = opts.outPath
    ? (opts.outPath.startsWith(root) ? opts.outPath : join(root, opts.outPath))
    : join(root, app.output?.dir || 'output', defaultName);
  const mdPath = wechatPath.replace(/-wechat\.md$/, '.md');
  const jsonPath = wechatPath.replace(/-wechat\.md$/, '.json');

  const wechat = picked.length
    ? renderWechat(picked, meta)
    : `【AI 日报 ${stamp.slice(5)}】今日无重要更新。\n\n— 本次运行：信源 ${tried} 试 ${okSources} 成，失败 ${failures.length} 个；没有达到筛选标准的内容，不凑数。\n`;

  if (!dryRun && existsSync(wechatPath)) {
    await writeText(join(root, 'archive/.keep'), '');
    await rename(wechatPath, join(dirname(wechatPath), '..', 'archive', `${stamp}-${topic}-wechat.prev.md`)).catch(() => {});
  }

  await writeText(wechatPath, wechat);
  await writeText(mdPath, renderMd(picked, meta));
  await writeText(jsonPath, JSON.stringify({ meta, items: picked }, null, 2));

  /* ---- 去重表 & 日志 ---- */
  if (!dryRun) {
    for (const it of picked) seen[fingerprint(it)] = Date.now();
    await writeText(seenPath, JSON.stringify(seen, null, 2));
  }

  const duration = Date.now() - t0;
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
    min_score: minScore,
    duration_ms: duration,
    output: wechatPath,
    status: failures.length ? (picked.length ? 'ok_with_source_failure' : 'empty') : 'ok',
  };
  if (!dryRun) {
    await writeText(join(root, app.logging?.dir || 'logs', `${stamp}.jsonl`), JSON.stringify(entry) + '\n');
  }

  return {
    ok: true,
    meta,
    items: picked,
    failures,
    stats: { tried, okSources, candidates: items.length, scoredPass: scored.length, kept: picked.length, duration },
    paths: { wechat: wechatPath, md: mdPath, json: jsonPath },
    log: entry,
  };
}
