#!/usr/bin/env node
// src/serve.mjs —— 零依赖本地服务：面板 + 真实数据 + 一键运行
// 用法：node src/serve.mjs [--port 4177] [--dry-run]
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { readJson, readLogs } from './lib.mjs';
import { runOnce } from './pipeline.mjs';

const argv = process.argv.slice(2);
const arg = (k, d = null) => {
  const i = argv.indexOf('--' + k);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const root = resolve(process.cwd());
const PORT = Number(arg('port', process.env.PORT || 4177));
const DRY = argv.includes('--dry-run');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

const json = (res, code, obj) => {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
};

/** 找最新的简报 JSON 快照（优先正式产出，其次 dry-run） */
async function latestBrief() {
  const dir = join(root, 'output');
  if (!existsSync(dir)) return null;
  const { readdir } = await import('node:fs/promises');
  const all = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  const real = all.filter((f) => !f.startsWith('_')).sort();
  const dry = all.filter((f) => f.startsWith('_')).sort();
  const pick = real.length ? real[real.length - 1] : dry.length ? dry[dry.length - 1] : null;
  if (!pick) return null;
  try {
    const data = await readJson(join(dir, pick));
    return { file: pick, isDryRun: pick.startsWith('_'), ...data };
  } catch {
    return null;
  }
}

async function state() {
  const app = await readJson(join(root, 'config/app.json'));
  const topicDir = join(root, 'config/topics');
  const { readdir } = await import('node:fs/promises');
  const topics = (await readdir(topicDir))
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''));
  const runs = (await readLogs(join(root, app.logging?.dir || 'logs'))).slice(-20).reverse();
  const brief = await latestBrief();
  const sources = [];
  for (const rel of app.sources || []) {
    const p = join(root, rel);
    if (!existsSync(p)) continue;
    const cfg = await readJson(p);
    for (const s of cfg.sources || []) sources.push({ id: s.id, name: s.name, type: s.type, url: s.url, level: s.level });
  }
  return {
    ok: true,
    app: {
      schedule: app.schedule,
      windowDays: app.window_days,
      maxItems: app.max_items,
      minScore: app.min_score,
      defaultTopic: app.default_topic,
    },
    topics,
    sources,
    runs,
    brief,
    dryRun: DRY,
    now: new Date().toISOString(),
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;

  try {
    if (path === '/api/state') return json(res, 200, await state());

    if (path === '/api/run' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      let opts = {};
      try {
        opts = body ? JSON.parse(body) : {};
      } catch {}
      const started = Date.now();
      const out = await runOnce({
        root,
        topic: opts.topic,
        days: opts.days,
        dryRun: opts.dryRun ?? DRY,
        trigger: 'panel',
      });
      return json(res, 200, {
        ok: true,
        elapsed: Date.now() - started,
        stats: out.stats,
        items: out.items.map((i) => ({ title: i.title, score: i.score, url: i.url })),
        failures: out.failures,
        paths: out.paths,
      });
    }

    if (path === '/api/run' && req.method === 'GET') return json(res, 405, { ok: false, error: 'use POST' });

    // 面板上的「停止服务」按钮打这里：先回包，再退出
    if (path === '/api/stop' && req.method === 'POST') {
      json(res, 200, { ok: true, stopping: true });
      setTimeout(() => {
        console.log('\n  收到停止请求，服务已关闭。');
        process.exit(0);
      }, 250);
      return;
    }

    // 静态文件
    const file = path === '/' ? 'web/index.html' : join('web', path.replace(/^\/+/, ''));
    const abs = join(root, file);
    if (!abs.startsWith(join(root, 'web'))) return json(res, 403, { ok: false, error: 'forbidden' });
    if (!existsSync(abs)) return json(res, 404, { ok: false, error: 'not found' });
    const buf = await readFile(abs);
    res.writeHead(200, { 'content-type': MIME[extname(abs)] || 'application/octet-stream' });
    return res.end(buf);
  } catch (e) {
    return json(res, 500, { ok: false, error: String(e.message || e) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  面板已启动  http://127.0.0.1:${PORT}`);
  console.log(`  数据目录    ${root}`);
  console.log(`  模式        ${DRY ? 'dry-run（不联网）' : '真实抓取'}\n`);
  console.log('  Ctrl+C 停止。本服务只监听本机回环地址，不对外暴露。\n');
});
