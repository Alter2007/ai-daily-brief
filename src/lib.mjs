// src/lib.mjs —— 零依赖工具：HTTP / feed 解析 / 打分 / 渲染 / 存储
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

export const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));

export async function writeText(p, s) {
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, s, 'utf8');
}

export async function httpText(url, { timeout = 20000, headers = {} } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeout);
  try {
    const r = await fetch(url, {
      signal: ac.signal,
      headers: { 'user-agent': 'ai-daily-brief/0.1 (+https://github.com)', ...headers },
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}

/* ---------------- feed 解析（RSS 2.0 / Atom） ---------------- */

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function strip(s = '') {
  let x = String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (m, k) => ENT[k] ?? m)
    // 先解实体再去标签：有的 feed 把 HTML 转义过，反过来会漏
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (m, k) => ENT[k] ?? m)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return x;
}

const pick = (block, tag) => {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1] : '';
};

export function parseFeed(xml) {
  const blocks = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  return blocks
    .map((b) => {
      const title = strip(pick(b, 'title'));
      const link =
        (b.match(/<link[^>]*href="([^"]+)"/i) || [])[1] ||
        strip(pick(b, 'link')) ||
        strip(pick(b, 'id'));
      const rawDate = pick(b, 'pubDate') || pick(b, 'updated') || pick(b, 'published') || '';
      const summary = strip(pick(b, 'description') || pick(b, 'summary') || pick(b, 'content'));
      return { title, url: link.trim(), date: toIso(rawDate), summary: summary.slice(0, 400) };
    })
    .filter((x) => x.title && /^https?:\/\//.test(x.url));
}

export function toIso(s) {
  if (!s) return null;
  const t = Date.parse(strip(s));
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/* ---------------- 主题规则 ---------------- */

export function parseTopic(md) {
  const grab = (head) => {
    const m = md.split(/^##\s+/m).find((x) => x.startsWith(head));
    return m ? m.split('\n').slice(1).join('\n') : '';
  };
  const words = (s) =>
    s
      .split('\n')
      .filter((l) => l.trim() && !l.startsWith('#'))
      .join(' ')
      .split(/[\s、，,]+/)
      .map((w) => w.trim())
      .filter((w) => w && !/^[`（(].*/.test(w));

  const audience = (md.match(/面向([^，。\n]+)/) || [])[1] || '关注这条线的人';

  // ## 信源
  // include: vendor, research
  // exclude: arxiv
  const srcBlock = grab('信源');
  const pickList = (k) => {
    const m = srcBlock.match(new RegExp(k + '[:：]\\s*(.+)', 'i'));
    return m ? m[1].split(/[,，\s]+/).map((x) => x.trim()).filter(Boolean) : [];
  };

  return {
    buzz: words(grab('加分词')),
    negative: words(grab('减分词')),
    audience,
    firstPartyBonus: /20/.test(grab('一手源加成')) ? 20 : 15,
    filter: { include: pickList('include'), exclude: pickList('exclude') },
  };
}

/** 判断某个信源是否被主题允许 */
export function sourceAllowed(src, filter = {}) {
  const keys = [src.id, src.category, src.type].filter(Boolean);
  const exc = filter.exclude || [];
  const inc = filter.include || [];
  if (exc.some((k) => keys.includes(k))) return false;
  if (inc.length) return inc.some((k) => keys.includes(k));
  return true;
}

/* 分类标签：先看主题里给的分类，再用内置关键词兜底 */
const TAG_RULES = [
  ['风险', ['漏洞', '泄露', '安全', '停服', '下线', '监管', '立法', '封禁', '诉讼', '裁员']],
  ['产品', ['发布', '上线', '定价', '免费', '涨价', '降价', '集成', '预约', '发售']],
  ['技术', ['开源', '论文', '模型', 'benchmark', '上下文', '框架', '推理', '训练', 'release', 'feat']],
  ['行业', ['收购', '融资', '合作', '投资', '席位', '全员', '生态', '联盟', '基金会']],
];

export function pickTag(item) {
  const text = (item.title + ' ' + (item.summary || '')).toLowerCase();
  for (const [tag, words] of TAG_RULES) {
    if (words.some((w) => text.includes(w.toLowerCase()))) return tag;
  }
  return '动态';
}

export function score(item, topic, now = Date.now()) {
  const text = (item.title + ' ' + (item.summary || '')).toLowerCase();
  let hits = 0;
  for (const w of topic.buzz) if (w && text.includes(w.toLowerCase())) hits++;

  let s = 10; // 基础分：格式完整，但不足以单独进简报
  s += Math.min(hits * 10, 30);
  if (hits === 0) s -= 10; // 与主题词零命中 → 视为不相关
  for (const w of topic.negative) if (w && text.includes(w.toLowerCase())) s -= 25;
  if (item.level === 'first-party') s += topic.firstPartyBonus;

  const age = item.date ? (now - Date.parse(item.date)) / 86400000 : 99;
  if (age <= 1) s += 10;
  else if (age <= 3) s += 5;

  return Math.max(0, s);
}

/* ---------------- 去重 ---------------- */

export const fingerprint = (item) =>
  createHash('sha1')
    .update((item.title || '').toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, ''))
    .digest('hex')
    .slice(0, 16);

export async function loadSeen(seenPath, dedupeDays) {
  try {
    const raw = await readJson(seenPath);
    const cutoff = Date.now() - dedupeDays * 86400000;
    const kept = Object.entries(raw).filter(([, ts]) => ts >= cutoff);
    return Object.fromEntries(kept);
  } catch {
    return {};
  }
}

/* ---------------- 渲染 ---------------- */

const md = (d) => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function renderWechat(items, meta) {
  const head = `【AI 日报 ${md(meta.date)}】共 ${items.length} 条，窗口 ${meta.windowDays} 天`;
  const body = items
    .map((it, i) => {
      const tag = it.tags?.[0] || '动态';
      return [
        `${i + 1}️⃣ ${it.title}（${md(new Date(it.date))}）#${tag}`,
        `💡 重要：${it.summary || '—'}`,
        `👥 谁关注：${meta.audience}`,
        `🔗 ${it.org} · ${it.url}`,
      ].join('\n');
    })
    .join('\n\n');
  const foot = `— 本次运行：信源 ${meta.tried} 试 ${meta.ok} 成，失败 ${meta.failed} 个`;
  return `${head}\n\n${body}\n\n${foot}\n`;
}

export function renderMd(items, meta) {
  const lines = [
    `# ${meta.topicName} · ${meta.date.toISOString().slice(0, 10)}`,
    '',
    `> 窗口 ${meta.windowDays} 天 · 信源 ${meta.tried} 试 ${meta.ok} 成 · ${items.length} 条 · 生成于 ${new Date().toISOString()}`,
    '',
  ];
  for (const it of items) {
    lines.push(
      `## ${it.title}`,
      '',
      `- **为什么重要**：${it.summary || '—'}`,
      `- **谁该看**：${meta.audience}`,
      `- **来源**：${it.org} · <${it.url}>`,
      `- **分数**：${it.score}`,
      ''
    );
  }
  return lines.join('\n');
}

/* ---------------- 日志 ---------------- */

export async function readLogs(dir) {
  try {
    await mkdir(dir, { recursive: true });
    const files = (await readdir(dir)).filter((f) => f.endsWith('.jsonl')).sort();
    const all = [];
    for (const f of files) {
      const txt = await readFile(join(dir, f), 'utf8');
      for (const line of txt.split('\n')) {
        if (line.trim()) {
          try {
            all.push(JSON.parse(line));
          } catch {}
        }
      }
    }
    return all;
  } catch {
    return [];
  }
}
