#!/usr/bin/env node
// src/serve.mjs —— 零依赖本地服务：面板 + 真实数据 + 一键运行
// 用法：node src/serve.mjs [--port 4177] [--dry-run]
import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, extname, dirname } from 'node:path';
import { readJson, readLogs } from './lib.mjs';
import { runOnce } from './pipeline.mjs';
import { resolveKey, MODEL } from './llm.mjs';

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

/** 当前是否有一次运行在跑（并发守卫） */
let RUNNING = null;

/* ---------- 本地设置（API key）---------- */

const LOCAL_CFG = () => join(root, 'config/app.local.json');
const maskKey = (k) => `${String(k).slice(0, 5)}…${String(k).slice(-4)}`;

async function readLocalCfg() {
  const p = LOCAL_CFG();
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(await readFile(p, 'utf8'));
  } catch {
    return {};
  }
}

async function writeLocalCfg(patch) {
  const p = LOCAL_CFG();
  const cur = await readLocalCfg();
  const next = { ...cur, ...patch };
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(next, null, 2) + '\n', 'utf8');
  return next;
}

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
  const settings = await readSettings();
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
    settings,
    running: RUNNING ? { startedAt: RUNNING.startedAt, topic: RUNNING.topic } : null,
    dryRun: DRY,
    now: new Date().toISOString(),
  };
}

/** key 只回掩码，绝不回明文 */
async function readSettings() {
  const k = await resolveKey(root);
  return {
    hasKey: !!k,
    keyFrom: k ? k.from : null,
    keyMask: k ? maskKey(k.key) : null,
    model: MODEL,
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;

  try {
    if (path === '/api/state') return json(res, 200, await state());

    /* 历史归档：列出 output 下所有快照（含条目，便于点开查看） */
    if (path === '/api/history') {
      const dir = join(root, 'output');
      if (!existsSync(dir)) return json(res, 200, { ok: true, items: [] });
      const { readdir } = await import('node:fs/promises');
      const files = (await readdir(dir))
        .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
        .sort()
        .reverse()
        .slice(0, 40);
      const list = [];
      for (const f of files) {
        try {
          const j = await readJson(join(dir, f));
          list.push({
            file: f,
            date: String(j.meta?.date || '').slice(0, 10),
            topic: j.meta?.topic || '',
            topicName: j.meta?.topicName || j.meta?.topic || '',
            count: (j.items || []).length,
            recall: !!j.meta?.recall,
            items: j.items || [],
          });
        } catch {}
      }
      return json(res, 200, { ok: true, items: list });
    }

    /* 保存 / 清除 DeepSeek key（只写 config/app.local.json，已 gitignore） */
    if (path === '/api/settings' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      let opts = {};
      try {
        opts = body ? JSON.parse(body) : {};
      } catch {}

      if (opts.clear) {
        await writeLocalCfg({ deepseekKey: undefined });
        return json(res, 200, { ok: true, ...(await readSettings()) });
      }

      const key = String(opts.deepseekKey || '').trim();
      if (key.length < 10 || !/^[\w-]+$/.test(key)) {
        return json(res, 400, { ok: false, error: 'key 格式不对（应为 sk- 开头的长串）' });
      }
      await writeLocalCfg({ deepseekKey: key });
      return json(res, 200, { ok: true, ...(await readSettings()) });
    }

    /* 用当前 key 试跑一次，只验证连通性，不产出文件 */
    if (path === '/api/settings/test' && req.method === 'POST') {
      const k = await resolveKey(root);
      if (!k) return json(res, 400, { ok: false, error: '还没填 key' });
      try {
        const { data } = await (async () => {
          const r = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${k.key}` },
            body: JSON.stringify({
              model: MODEL,
              messages: [{ role: 'user', content: '回复两个字：可用' }],
              max_tokens: 8,
            }),
            signal: AbortSignal.timeout(20000),
          });
          return { data: { status: r.status, text: await r.text() } };
        })();
        if (data.status !== 200) return json(res, 400, { ok: false, error: 'HTTP ' + data.status, detail: data.text.slice(0, 200) });
        return json(res, 200, { ok: true, reply: JSON.parse(data.text).choices?.[0]?.message?.content || '' });
      } catch (e) {
        return json(res, 500, { ok: false, error: String(e.message || e).slice(0, 160) });
      }
    }

    if (path === '/api/run' && req.method === 'POST') {
      // 并发守卫：连点两次不该跑两遍、写两次文件
      if (RUNNING) {
        return json(res, 409, {
          ok: false,
          error: '已有一次运行在进行中',
          runningFor: Date.now() - RUNNING.startedAt,
        });
      }
      let body = '';
      for await (const chunk of req) body += chunk;
      let opts = {};
      try {
        opts = body ? JSON.parse(body) : {};
      } catch {}

      RUNNING = { startedAt: Date.now(), topic: opts.topic || null };
      const started = Date.now();
      try {
        const out = await runOnce({
          root,
          topic: opts.topic,
          days: opts.days,
          dryRun: opts.dryRun ?? DRY,
          llm: opts.llm,
          trigger: 'panel',
        });
        return json(res, out.ok ? 200 : 502, {
          ok: out.ok,
          status: out.status,
          error: out.ok ? undefined : '全部信源不可用，已记录到 logs/_failed-*.json',
          elapsed: Date.now() - started,
          stats: out.stats,
          llm: out.llm,
          items: out.items.map((i) => ({ title: i.title, score: i.score, url: i.url, why: i.why, who: i.who })),
          failures: out.failures,
          paths: out.paths,
        });
      } finally {
        RUNNING = null;
      }
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
