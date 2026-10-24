import test from 'node:test';
import assert from 'node:assert/strict';
import { strip, parseFeed, parseTopic, score, sourceAllowed, fingerprint } from '../src/lib.mjs';
import { runOnce } from '../src/pipeline.mjs';

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

/* ---------------- 去重指纹 ---------------- */

test('标题归一化后指纹一致', () => {
  assert.equal(
    fingerprint({ title: 'OpenAI 发布新模型！' }),
    fingerprint({ title: 'openai 发布新模型' })
  );
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
