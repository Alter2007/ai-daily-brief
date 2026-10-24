#!/usr/bin/env node
// scripts/probe-feeds.mjs —— 批量探测候选信源是否可用（零依赖）
// 用法：
//   node scripts/probe-feeds.mjs https://a/feed https://b/feed
//   node scripts/probe-feeds.mjs --from config/sources/rss.json
import { readFile } from 'node:fs/promises';
import { parseFeed } from '../src/lib.mjs';

const argv = process.argv.slice(2);
const fromIdx = argv.indexOf('--from');
let targets = argv.filter((a) => /^https?:\/\//.test(a));

if (fromIdx >= 0) {
  const cfg = JSON.parse(await readFile(argv[fromIdx + 1], 'utf8'));
  targets = (cfg.sources || []).filter((s) => s.url).map((s) => s.url);
}
if (!targets.length) {
  console.error('用法: node scripts/probe-feeds.mjs <url...> | --from config/sources/rss.json');
  process.exit(2);
}

const TIMEOUT = 15000;

async function probe(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT);
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      signal: ac.signal,
      headers: {
        'user-agent': 'ai-daily-brief/0.1 (+https://github.com)',
        accept: 'application/rss+xml,application/atom+xml,application/xml,text/xml,*/*',
      },
      redirect: 'follow',
    });
    const body = await r.text();
    const items = /<(item|entry)\b/i.test(body) ? parseFeed(body) : [];
    const ms = Date.now() - t0;
    return {
      url,
      ok: r.ok && items.length > 0,
      status: r.status,
      type: (r.headers.get('content-type') || '').split(';')[0],
      bytes: Buffer.byteLength(body, 'utf8'),
      items: items.length,
      first: items[0]?.title?.slice(0, 46) || '',
      ms,
    };
  } catch (e) {
    return { url, ok: false, status: 'ERR', type: e.name, bytes: 0, items: 0, first: String(e.message).slice(0, 40), ms: Date.now() - t0 };
  } finally {
    clearTimeout(t);
  }
}

const results = await Promise.all(targets.map(probe));
const okCount = results.filter((r) => r.ok).length;

for (const r of results) {
  const mark = r.ok ? '✓' : '✗';
  console.log(
    `${mark} ${String(r.status).padEnd(4)} ${String(r.type).slice(0, 22).padEnd(23)} ${String(r.items).padStart(3)} 条 ${String(r.bytes).padStart(7)}B ${String(r.ms).padStart(6)}ms  ${r.url}`
  );
  if (!r.ok && r.first) console.log(`    ↳ ${r.first}`);
}

console.log(`\n可用 ${okCount} / ${results.length}`);
process.exit(okCount ? 0 : 1);
