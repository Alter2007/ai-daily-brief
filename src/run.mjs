#!/usr/bin/env node
// src/run.mjs —— CLI 入口：解析参数 → 调 pipeline → 打印摘要
import { runOnce } from './pipeline.mjs';

const argv = process.argv.slice(2);
const arg = (k, d = null) => {
  const i = argv.indexOf('--' + k);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const flag = (k) => argv.includes('--' + k);

const res = await runOnce({
  topic: arg('topic'),
  days: arg('days') ? Number(arg('days')) : undefined,
  max: arg('max') ? Number(arg('max')) : undefined,
  minScore: arg('min_score') ? Number(arg('min_score')) : undefined,
  dryRun: flag('dry-run'),
  onlySources: (arg('source') || '').split(',').filter(Boolean),
  outPath: arg('out'),
  trigger: 'manual',
});

const { meta, stats, failures, items, paths } = res;
const rel = (p) => p.replace(process.cwd() + '\\', '').replace(process.cwd() + '/', '');
console.log(`主题      ${meta.topicName}（${meta.topic}）${flag('dry-run') ? ' [dry-run]' : ''}`);
console.log(`窗口      ${meta.windowDays} 天｜上限 ${meta.maxItems} 条｜门槛 ${meta.minScore} 分`);
console.log(`信源      ${stats.tried} 试 / ${stats.okSources} 成${failures.length ? ' / 失败 ' + failures.length : ''}`);
failures.forEach((f) => console.log(`  ✗ ${f.source}: ${f.error}`));
console.log(`候选      ${stats.candidates} 条 → 过门槛 ${stats.scoredPass} → 采用 ${stats.kept}`);
items.forEach((p, i) => console.log(`  ${i + 1}. [${p.score}] ${p.title.slice(0, 60)}`));
console.log(`耗时      ${stats.duration} ms`);
console.log(`输出      ${rel(paths.wechat)}`);

if (items.length === 0) console.log('提示      无达到标准的内容，已输出「今日无重要更新」');

// 退出码约定：0 正常（含空结果）｜2 全部信源失败（定时任务应当报警）
if (res.status === 'all_sources_failed') {
  console.error(`\n失败      ${stats.tried} 个信源全部不可用，已在 logs/_failed-*.json 留下记录`);
  process.exit(2);
}
if (res.llm?.used && !res.llm.ok) {
  console.log(`提示      模型摘要失败，已降级为原文摘要：${res.llm.note || ''}`);
}
