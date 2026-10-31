import test from 'node:test';
import assert from 'node:assert/strict';
import { strip, parseFeed, parseTopic, score, sourceAllowed, fingerprint, hasBreaking, selectItems, ymd, mapLimit, recentSnapshots, isWeakSummary, splitQuery, filterByQuery } from '../src/lib.mjs';
import { resolveKey } from '../src/llm.mjs';
import { collectGithub } from '../src/sources.mjs';
import { runOnce } from '../src/pipeline.mjs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* ---------------- 文本清洗 ---------------- */

test('strip 去掉 HTML 并解实体', () => {
  const raw = '<p>Hello <b>AI</b> &amp; world</p>';
  assert.equal(strip(raw), 'Hello AI & world');
});

test('strip 处理被转义过的 HTML（InfoQ 那种）', () => {
  const raw = "&lt;div align='right'&gt;&lt;a href='https://x'&gt;点击查看原文&lt;/a&gt;&lt;/div&gt;正文";
  const out = strip(raw);
  assert.ok(!out.includes('<'), '不应残留标签: ' + out);
  assert.ok(out.includes('正文'));
});

test('strip 解开 CDATA', () => {
  assert.equal(strip('<![CDATA[纯文本]]>'), '纯文本');
});

/* ---------------- feed 解析 ---------------- */

test('parseFeed 解析 RSS 2.0', () => {
  const xml = `<rss><channel><item><title>发布 A</title><link>https://a.com/1</link>
    <pubDate>Fri, 24 Oct 2026 02:00:00 GMT</pubDate><description>desc</description></item></channel></rss>`;
  const items = parseFeed(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, '发布 A');
  assert.equal(items[0].url, 'https://a.com/1');
  assert.match(items[0].date, /^2026-10-24/);
});

test('parseFeed 解析 Atom 的 link href', () => {
  const xml = `<feed><entry><title>Paper B</title><link href="https://b.com/2"/>
    <updated>2026-10-23T10:00:00Z</updated><summary>abs</summary></entry></feed>`;
  const items = parseFeed(xml);
  assert.equal(items[0].url, 'https://b.com/2');
  assert.equal(items[0].title, 'Paper B');
});

test('parseFeed 丢弃无链接条目', () => {
  const xml = `<rss><channel><item><title>无链接</title></item></channel></rss>`;
  assert.equal(parseFeed(xml).length, 0);
});

/* ---------------- 主题解析与过滤 ---------------- */

const TOPIC_MD = `# 主题：测试主题

面向测试读者。

## 分类
\`#产品\`

## 加分词
发布 release

## 减分词
传闻 rumor

## 信源
include: vendor, research
exclude: arxiv
`;

test('parseTopic 读出台词表、受众、信源过滤', () => {
  const t = parseTopic(TOPIC_MD);
  assert.deepEqual(t.buzz.sort(), ['release', '发布'].sort());
  assert.deepEqual(t.negative.sort(), ['rumor', '传闻'].sort());
  assert.equal(t.audience, '测试读者');
  assert.deepEqual(t.filter.include, ['vendor', 'research']);
  assert.deepEqual(t.filter.exclude, ['arxiv']);
});

test('sourceAllowed 按 id / category / type 匹配', () => {
  const f = { include: ['vendor'], exclude: ['arxiv'] };
  assert.equal(sourceAllowed({ id: 'x', category: 'vendor' }, f), true);
  assert.equal(sourceAllowed({ id: 'arxiv-ai', category: 'research' }, f), false);
  assert.equal(sourceAllowed({ id: 'y', category: 'media' }, f), false);
  // include 为空 = 全放行
  assert.equal(sourceAllowed({ id: 'z', category: 'media' }, { exclude: [] }), true);
});

/* ---------------- 打分 ---------------- */

const T = parseTopic(TOPIC_MD);
const now = Date.parse('2026-10-24T12:00:00Z');

test('零命中的一手新鲜条目不能进简报', () => {
  const s = score(
    { title: 'At MIT, someone speaks on democracy', summary: '', level: 'first-party', date: '2026-10-24T08:00:00Z' },
    T, now
  );
  assert.ok(s < 40, '应被门槛挡住，实际 ' + s);
});

test('命中一个关键词即可过门槛', () => {
  const s = score(
    { title: 'OpenAI 发布新模型', summary: '', level: 'first-party', date: '2026-10-24T08:00:00Z' },
    T, now
  );
  assert.ok(s >= 40, '应通过，实际 ' + s);
});

test('传闻类被显著降权', () => {
  const ok = score({ title: '发布新模型', summary: '', level: 'second-hand', date: '2026-10-24T08:00:00Z' }, T, now);
  const rumor = score({ title: '传闻：或将发布新模型', summary: '', level: 'second-hand', date: '2026-10-24T08:00:00Z' }, T, now);
  assert.ok(rumor < ok, `传闻 ${rumor} 应低于正常 ${ok}`);
});

test('陈旧条目不拿新鲜度加分', () => {
  const fresh = score({ title: '发布 A', summary: '', level: 'second-hand', date: '2026-10-24T08:00:00Z' }, T, now);
  const old = score({ title: '发布 A', summary: '', level: 'second-hand', date: '2026-10-01T08:00:00Z' }, T, now);
  assert.ok(fresh > old);
});

test('主题里的权重覆盖默认值', () => {
  const item = { title: '无关内容', summary: '', level: 'second-hand', date: '2026-10-24T08:00:00Z' };
  const dflt = score(item, T, now); // 零命中 −10
  const loose = parseTopic(`# 主题：宽松

## 权重
zero_hit_penalty: 0
`);
  const l = score(item, loose, now);
  assert.equal(l - dflt, 10, `把零命中惩罚归零应恰好提高 10 分：${l} vs ${dflt}`);
});

test('权重可解析成数字', () => {
  const t = parseTopic(`# 主题：x

## 权重
base: 5
per_hit: 20
`);
  assert.equal(t.weights.base, 5);
  assert.equal(t.weights.per_hit, 20);
});

/* ---------------- 去重指纹 ---------------- */

test('标题归一化后指纹一致', () => {
  assert.equal(
    fingerprint({ title: 'OpenAI 发布新模型！' }),
    fingerprint({ title: 'openai 发布新模型' })
  );
});

/* ---------------- GitHub 适配器 ---------------- */

const GH_CFG = {
  sources: [
    { id: 'repo-x', name: 'example/repo', type: 'github', kind: 'releases', repo: 'example/repo', level: 'first-party' },
  ],
};

test('releases：解析标题、链接、日期，并识别破坏性变更', async () => {
  const out = await collectGithub(GH_CFG, { dryRun: true, root: process.cwd() });
  assert.equal(out.tried, 1);
  assert.equal(out.ok, 1);
  assert.equal(out.failures.length, 0);
  assert.ok(out.items.length >= 2);
  const v52 = out.items.find((i) => i.title.includes('v5.2.0'));
  assert.ok(v52, '应包含 v5.2.0');
  assert.match(v52.url, /^https:\/\/github\.com\//);
  assert.equal(v52.breaking, true, 'v5.2.0 正文含 breaking，应标记');
});

test('commits：过滤 merge / chore，保留 feat 与 fix，标记破坏性变更', async () => {
  const cfg = {
    sources: [
      { id: 'c', name: 'example/repo', type: 'github', kind: 'commits', repo: 'example/repo', level: 'first-party' },
    ],
  };
  const out = await collectGithub(cfg, { dryRun: true, root: process.cwd(), days: 3 });
  const titles = out.items.map((i) => i.title).join(' | ');
  assert.ok(!/Merge pull request/i.test(titles), 'merge 提交应被过滤: ' + titles);
  assert.ok(!/chore:/i.test(titles), 'chore 提交应被过滤: ' + titles);
  assert.ok(/feat: 支持流式工具调用/.test(titles), 'feat 应保留: ' + titles);
  const breaking = out.items.find((i) => /移除 v4 兼容层/.test(i.title));
  assert.ok(breaking?.breaking, 'fix! 应标记为破坏性变更');
});

test('hasBreaking 识别多种写法', () => {
  assert.equal(hasBreaking('BREAKING CHANGE: 移除旧接口'), true);
  assert.equal(hasBreaking('fix!: 不兼容改动'), true);
  assert.equal(hasBreaking('breaking: changed api'), true);
  assert.equal(hasBreaking('普通修复'), false);
});

/* ---------------- 选择与去重 ---------------- */

const mk = (title, extra = {}) => ({
  title,
  summary: '发布 新模型',
  level: 'first-party',
  date: '2026-10-24T08:00:00Z',
  source: 's1',
  ...extra,
});

test('selectItems 跳过已见过的条目，不重复推送', () => {
  const a = mk('OpenAI 发布 A');
  const b = mk('OpenAI 发布 B');
  const seen = { [fingerprint(a)]: Date.now() };
  const { picked, skipped } = selectItems([a, b], { seen, topic: T, maxItems: 5, minScore: 0 });
  assert.equal(picked.length, 1);
  assert.equal(picked[0].title, 'OpenAI 发布 B');
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].reason, 'duplicate');
});

test('selectItems 同一次运行内按指纹去重', () => {
  const { picked } = selectItems([mk('发布 X！'), mk('发布 x')], { topic: T, maxItems: 5, minScore: 0 });
  assert.equal(picked.length, 1, '归一化后同标题只留一条');
});

test('selectItems 按分数截断到 maxItems', () => {
  const items = [mk('发布 高分', { level: 'first-party' }), mk('发布 中分', { level: 'second-hand' }), mk('发布 低分', { level: 'second-hand', date: '2026-09-01T00:00:00Z' })];
  const { picked } = selectItems(items, { topic: T, maxItems: 2, minScore: 0 });
  assert.equal(picked.length, 2);
  assert.ok(picked[0].score >= picked[1].score);
});

test('selectItems 过滤掉低于门槛的条目', () => {
  const { picked } = selectItems([mk('毫不相关的内容', { level: 'second-hand' })], { topic: T, minScore: 40 });
  assert.equal(picked.length, 0);
});

/* ---------------- 日期与并发 ---------------- */

test('ymd 用本地日期，不受 UTC 影响', () => {
  // 本地 07:00 在 UTC+8 是前一天 23:00，toISOString 会算错
  assert.equal(ymd(new Date(2026, 9, 25, 7, 0)), '2026-10-25');
  assert.equal(ymd(new Date(2026, 0, 1, 0, 0)), '2026-01-01');
  assert.equal(ymd(new Date(2026, 11, 31, 23, 59)), '2026-12-31');
});

test('mapLimit 保持顺序且并发不超过上限', async () => {
  let live = 0;
  let peak = 0;
  const input = [1, 2, 3, 4, 5, 6, 7];
  const out = await mapLimit(input, 3, async (n) => {
    live++;
    peak = Math.max(peak, live);
    await new Promise((r) => setTimeout(r, 10));
    live--;
    return n * 2;
  });
  assert.deepEqual(out, [2, 4, 6, 8, 10, 12, 14]);
  assert.ok(peak <= 3, '并发峰值应 ≤ 3，实际 ' + peak);
});

/* ---------------- 回顾与归档 ---------------- */

/* ---------------- 搜索 ---------------- */

test('splitQuery 支持中英文分隔符', () => {
  assert.deepEqual(splitQuery('Gemini 开源'), ['Gemini', '开源']);
  assert.deepEqual(splitQuery('a,b，c、d'), ['a', 'b', 'c', 'd']);
  assert.deepEqual(splitQuery('   '), []);
  assert.deepEqual(splitQuery(null), []);
});

test('filterByQuery 命中标题或摘要，空词返回原列表', () => {
  const items = [
    { title: 'Gemini 4 Carbon released', summary: 'frontier model' },
    { title: 'OpenAI 开源新模型', summary: 'MIT license' },
    { title: 'Unrelated finance news', summary: 'funding round' },
  ];
  assert.equal(filterByQuery(items, []).length, 3, '无关键词不过滤');
  assert.equal(filterByQuery(items, splitQuery('gemini')).length, 1, '大小写不敏感');
  assert.equal(filterByQuery(items, splitQuery('开源')).length, 1, '中文命中标题');
  assert.equal(filterByQuery(items, splitQuery('MIT')).length, 1, '命中摘要');
  assert.equal(filterByQuery(items, splitQuery('gemini 开源')).length, 2, '多词取并集');
  assert.equal(filterByQuery(items, splitQuery('nothing')).length, 0);
});

/* ---------------- 摘要质量 ---------------- */

test('isWeakSummary 识别占位串 / 过短 / 纯链接', () => {
  assert.equal(isWeakSummary('点击查看原文'), true, 'InfoQ 的占位串');
  assert.equal(isWeakSummary('点击查看原文>'), true);
  assert.equal(isWeakSummary('短'), true, '少于 12 字');
  assert.equal(isWeakSummary('https://example.com/a'), true, '只有链接');
  assert.equal(isWeakSummary(''), true);
  assert.equal(
    isWeakSummary('The financing gives SpaceX another way to fund its AI ambitions.'),
    false,
    '正常英文摘要不算弱'
  );
  assert.equal(isWeakSummary('新版本在智能指数上提升 3 分，长程任务表现更好。'), false);
});

test('快照选择：同一主题、排除当天、跳过 dry-run', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'adb-'));
  try {
    const write = (name, topic) =>
      writeFile(join(dir, name), JSON.stringify({ meta: { topic }, items: [{ title: 'x' }] }));
    await write('2026-10-24-ai-industry.json', 'ai-industry');
    await write('2026-10-25-ai-industry.json', 'ai-industry');
    await write('2026-10-24-research.json', 'research');
    await write('_dryrun-ai-industry.json', 'ai-industry');

    const all = await recentSnapshots(dir, { suffix: '-ai-industry.json', limit: 3 });
    assert.equal(all.length, 2, '应只有 2 个正式 ai-industry 快照（排除 _dryrun）');

    const withoutToday = await recentSnapshots(dir, {
      suffix: '-ai-industry.json',
      excludeStem: '2026-10-25-ai-industry',
      limit: 3,
    });
    assert.equal(withoutToday.length, 1);
    assert.equal(withoutToday[0].file, '2026-10-24-ai-industry.json');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('strip 去掉首尾残留的尖括号', () => {
  assert.equal(strip('&lt;div&gt;点击查看原文&lt;/div&gt;'), '点击查看原文');
  assert.equal(strip('  正文 &gt;  '), '正文');
});

/* ---------------- 配置健壮性 ---------------- */

test('readJson 能容忍 UTF-8 BOM', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'adb-'));
  try {
    const p = join(dir, 'cfg.json');
    await writeFile(p, '\uFEFF{"a":1}', 'utf8');
    const { readJson } = await import('../src/lib.mjs');
    assert.deepEqual(await readJson(p), { a: 1 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/* ---------------- API key 解析 ---------------- */

async function withTempRoot(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'adb-'));
  await mkdir(join(dir, 'config'), { recursive: true });
  const prev = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    return await fn(dir);
  } finally {
    if (prev === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = prev;
    await rm(dir, { recursive: true, force: true });
  }
}

test('resolveKey 无 key 时返回 null', async () => {
  await withTempRoot(async (dir) => {
    assert.equal(await resolveKey(dir), null);
  });
});

test('resolveKey 从 config/app.local.json 读取', async () => {
  await withTempRoot(async (dir) => {
    await writeFile(join(dir, 'config/app.local.json'), JSON.stringify({ deepseekKey: 'sk-unit-test-123' }));
    const k = await resolveKey(dir);
    assert.equal(k?.key, 'sk-unit-test-123');
    assert.equal(k?.from, 'file');
  });
});

test('resolveKey 环境变量优先于文件', async () => {
  await withTempRoot(async (dir) => {
    await writeFile(join(dir, 'config/app.local.json'), JSON.stringify({ deepseekKey: 'sk-from-file' }));
    process.env.DEEPSEEK_API_KEY = 'sk-from-env';
    const k = await resolveKey(dir);
    assert.equal(k?.key, 'sk-from-env');
    assert.equal(k?.from, 'env');
  });
});

/* ---------------- 端到端（离线） ---------------- */

test('dry-run 端到端产出条目与文件', async () => {
  const res = await runOnce({ dryRun: true, topic: 'ai-industry', days: 3, max: 5 });
  assert.equal(res.ok, true);
  assert.ok(res.items.length > 0, '应至少采纳 1 条');
  assert.ok(res.items.length <= 5);
  assert.ok(res.paths.wechat.endsWith('-wechat.md'));
  assert.equal(res.stats.tried >= 1, true);
});

test('dry-run 的 github-watch 只出 release', async () => {
  const res = await runOnce({ dryRun: true, topic: 'github-watch' });
  assert.ok(res.items.every((i) => /v?\d+\.\d+/.test(i.title)), '条目应为版本号形式');
});
