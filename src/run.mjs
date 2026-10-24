#!/usr/bin/env node
// src/run.mjs —— 主线：读配置 → 抓取 → 过滤打分 → 去重 → 渲染 → 落盘
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  readJson, writeText, parseTopic, score, fingerprint, loadSeen,
  renderWechat, renderMd, pickTag,
} from './lib.mjs';
import { COLLECTORS } from './sources.mjs';

/* ---------------- 参数 ---------------- */
const argv = process.argv.slice(2);
const arg = (k, d = null) => {
  const i = argv.indexOf('--' + k);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const flag = (k) => argv.includes('--' + k);

const dryRun = flag('dry-run');
const onlySources = (arg('source') || '').split(',').filter(Boolean);
const root = resolve(process.cwd());

const app = await readJson(join(root, 'config/app.json'));
const topicName = arg('topic', app.default_topic);
const days = Number(arg('days', app.window_days));
const maxItems = Number(arg('max', app.max_items));
const minScore = Number(arg('min_score', app.min_score));
const outPath = arg('out', null);

const topicMd = await readFile(join(root, 'config/topics', topicName + '.md'), 'utf8');
const topic = parseTopic(topicMd);
const topicTitle = (topicMd.match(/^#\s+主题[:：]\s*(.+)$/m) || [])[1] || topicName;

/* ---------------- 抓取（并发） ---------------- */
const t0 = Date.now();
const jobs = [];
for (const rel of app.sources || []) {
  const cfgPath = join(root, rel);
  if (!existsSync(cfgPath)) continue;
  const cfg = await readJson(cfgPath);
  // dry-run 只用每类第一个信源：夹具只有一份，多源重复加载会被人为去重掉
  if (dryRun && Array.isArray(cfg.sources)) cfg.sources = cfg.sources.slice(0, 1);
  const types = new Set((cfg.sources || []).map((s) => s.type));
  for (const t of types) {
    if (onlySources.length && !onlySources.includes(t)) continue;
    const collector = COLLECTORS[t];
    if (collector) jobs.push(collector(cfg, { dryRun }));
  }
}
const results = await Promise.all(jobs);

const items = [];
const failures = [];
let tried = 0;
let ok = 0;
for (const r of results) {
  items.push(...r.items);
  failures.push(...r.failures);
  tried += r.tried;
  ok += r.ok;
}

/* ---------------- 过滤 / 打分 / 去重 ---------------- */
const cutoff = Date.now() - days * 86400000;
const seenPath = join(root, 'seen.json');
const seen = dryRun ? {} : await loadSeen(seenPath, app.dedupe_days || 7);

const scored = items
  .filter((it) => {
    if (dryRun) return true; // 夹具日期是固定的，dry-run 不做窗口过滤
    const t = it.date ? Date.parse(it.date) : NaN;
    return Number.isFinite(t) ? t >= cutoff : true;
  })
  .map((it) => ({
    ...it,
    score: score(it, topic),
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

/* ---------------- 渲染 ---------------- */
const meta = {
  date: new Date(),
  windowDays: days,
  topicName: topicTitle,
  audience: topic.audience,
  tried,
  ok,
  failed: failures.length,
};

const stamp = meta.date.toISOString().slice(0, 10);
const defaultName = dryRun
  ? `_dryrun-${topicName}-wechat.md`
  : `${stamp}-${topicName}-wechat.md`;
const wechatPath = outPath || join(app.output?.dir || 'output', defaultName);
const mdPath = wechatPath.replace(/-wechat\.md$/, '.md');

let wechat = picked.length
  ? renderWechat(picked, meta)
  : `【AI 日报 ${stamp.slice(5)}】今日无重要更新。\n\n— 本次运行：信源 ${tried} 试 ${ok} 成，失败 ${failures.length} 个；没有达到筛选标准的内容，不凑数。\n`;

if (!dryRun && existsSync(join(root, wechatPath))) {
  const { rename } = await import('node:fs/promises');
  await writeText(join(root, 'archive/.keep'), '');
  await rename(join(root, wechatPath), join(root, 'archive', `${stamp}-${topicName}-wechat.prev.md`)).catch(() => {});
}

await writeText(join(root, wechatPath), wechat);
await writeText(join(root, mdPath), renderMd(picked, meta));

/* ---------------- 去重表 & 日志 ---------------- */
if (!dryRun) {
  for (const it of picked) seen[fingerprint(it)] = Date.now();
  await writeText(seenPath, JSON.stringify(seen, null, 2));
}

const duration = Date.now() - t0;
const logLine = JSON.stringify({
  run_id: `${stamp}-${topicName}`,
  trigger: dryRun ? 'dry-run' : 'manual',
  topic: topicName,
  window_days: days,
  sources_tried: tried,
  sources_ok: ok,
  sources_failed: failures,
  candidates: items.length,
  scored_pass: scored.length,
  items_kept: picked.length,
  min_score: minScore,
  duration_ms: duration,
  output: wechatPath,
  status: failures.length ? (picked.length ? 'ok_with_source_failure' : 'empty') : 'ok',
});
if (!dryRun) {
  await writeText(join(root, app.logging?.dir || 'logs', `${stamp}.jsonl`), logLine + '\n');
}

/* ---------------- 控制台摘要 ---------------- */
console.log(`主题      ${topicTitle}（${topicName}）${dryRun ? ' [dry-run]' : ''}`);
console.log(`窗口      ${days} 天｜上限 ${maxItems} 条｜门槛 ${minScore} 分`);
console.log(`信源      ${tried} 试 / ${ok} 成${failures.length ? ' / 失败 ' + failures.length : ''}`);
failures.forEach((f) => console.log(`  ✗ ${f.source}: ${f.error}`));
console.log(`候选      ${items.length} 条 → 过门槛 ${scored.length} → 采用 ${picked.length}`);
picked.forEach((p, i) => console.log(`  ${i + 1}. [${p.score}] ${p.title.slice(0, 60)}`));
console.log(`耗时      ${duration} ms`);
console.log(`输出      ${wechatPath}`);
