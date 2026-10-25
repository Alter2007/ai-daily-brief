// src/llm.mjs —— 用 DeepSeek 生成「为什么重要 / 谁该看」。零依赖，只用 fetch。
// Key 优先级：环境变量 DEEPSEEK_API_KEY > config/app.local.json（已 gitignore）
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const MODEL = 'deepseek-chat';
export const ENDPOINT = 'https://api.deepseek.com/chat/completions';

/** 读 key；只在本机文件或环境变量里，绝不写日志、绝不出现在 /api/state 的响应里 */
export async function resolveKey(root) {
  const env = process.env.DEEPSEEK_API_KEY;
  if (env && env.trim()) return { key: env.trim(), from: 'env' };
  const p = join(root, 'config/app.local.json');
  if (existsSync(p)) {
    try {
      const j = JSON.parse(await readFile(p, 'utf8'));
      if (j.deepseekKey && String(j.deepseekKey).trim()) {
        return { key: String(j.deepseekKey).trim(), from: 'file' };
      }
    } catch {}
  }
  return null;
}

const SYS = [
  '你是面向普通职场人的中文 AI 情报编辑。',
  '输入是一批新闻条目，输出为每条写两句中文判断。',
  '只输出 JSON，结构：{"items":[{"why":"...","who":"..."}]}',
  'why：为什么重要，40 字以内，说清影响，不要复述标题。',
  'who：谁该看，20 字以内，给具体角色。',
  '不要编造事实、数字、日期；信息不足时写「影响待观察」「关注者」。',
].join('\n');

/** 给若干条目补 why / who；失败返回 null，由调用方降级为原文摘要 */
export async function enrich(items, key, opts = {}) {
  if (!items.length) return null;
  const payload = {
    model: opts.model || MODEL,
    messages: [
      { role: 'system', content: SYS },
      {
        role: 'user',
        content: JSON.stringify(
          items.map((it, i) => ({ i, title: it.title, summary: (it.summary || '').slice(0, 400) }))
        ),
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3,
    max_tokens: 900,
  };

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), opts.timeout ?? 25000);
  const t0 = Date.now();
  try {
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      signal: ac.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
    });
    const text = await r.text();
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + text.slice(0, 160));

    const j = JSON.parse(text);
    const content = j.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(content);
    const arr = Array.isArray(parsed.items) ? parsed.items : [];

    return {
      model: payload.model,
      ms: Date.now() - t0,
      usage: j.usage || null,
      items: items.map((it, i) => {
        const hit = arr.find((x) => Number(x.i) === i) || arr[i] || {};
        return {
          ...it,
          why: String(hit.why || '').trim().slice(0, 60),
          who: String(hit.who || '').trim().slice(0, 24),
        };
      }),
    };
  } finally {
    clearTimeout(t);
  }
}
