// src/sources.mjs —— 信源适配器：rss / github / arxiv / web(跳过)
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { httpText, parseFeed } from './lib.mjs';

async function fixture(name, root) {
  return readFile(join(root || process.cwd(), 'fixtures', name), 'utf8');
}

/* ---------- RSS / Atom ---------- */

export async function collectRss(cfg, opts = {}) {
  const out = { items: [], failures: [], tried: 0, ok: 0 };
  for (const s of cfg.sources || []) {
    if (s.type === 'web') continue; // code 模式跳过需要渲染的页面
    out.tried++;
    try {
      const xml = opts.dryRun ? await fixture('rss.xml', opts.root) : await httpText(s.url);
      const entries = parseFeed(xml);
      out.ok++;
      for (const e of entries) {
        out.items.push({ ...e, org: s.name, level: s.level, source: s.id });
      }
    } catch (e) {
      out.failures.push({ source: s.id, url: s.url, error: String(e.message || e) });
    }
  }
  return out;
}

/* ---------- GitHub releases ---------- */

export async function collectGithub(cfg, opts = {}) {
  const out = { items: [], failures: [], tried: 0, ok: 0 };
  const token = process.env.GITHUB_TOKEN;
  for (const s of cfg.sources || []) {
    if (s.type !== 'github') continue;
    out.tried++;
    try {
      const url = `https://api.github.com/repos/${s.repo}/releases?per_page=5`;
      const body = opts.dryRun
        ? await fixture('github.json', opts.root)
        : await httpText(url, {
            headers: {
              accept: 'application/vnd.github+json',
              ...(token ? { authorization: `Bearer ${token}` } : {}),
            },
          });
      const rels = JSON.parse(body);
      out.ok++;
      for (const r of Array.isArray(rels) ? rels : []) {
        if (r.draft) continue;
        out.items.push({
          title: `${s.name} ${r.tag_name || r.name || ''}`.trim(),
          url: r.html_url,
          date: r.published_at,
          summary: String(r.name || r.body || '').replace(/\s+/g, ' ').slice(0, 300),
          org: s.name,
          level: s.level,
          source: s.id,
        });
      }
    } catch (e) {
      out.failures.push({ source: s.id, url: `github:${s.repo}`, error: String(e.message || e) });
    }
  }
  return out;
}

/* ---------- arXiv ---------- */

export async function collectArxiv(cfg, opts = {}) {
  const out = { items: [], failures: [], tried: 0, ok: 0 };
  for (const s of cfg.sources || []) {
    if (s.type !== 'arxiv') continue;
    out.tried++;
    try {
      const q = (s.categories || ['cs.AI']).map((c) => `cat:${c}`).join('+OR+');
      const url = `https://export.arxiv.org/api/query?search_query=${q}&sortBy=submittedDate&sortOrder=descending&max_results=${s.max || 20}`;
      const xml = opts.dryRun ? await fixture('arxiv.xml', opts.root) : await httpText(url);
      out.ok++;
      for (const e of parseFeed(xml)) {
        out.items.push({ ...e, org: s.name, level: s.level, source: s.id, summary: e.summary.slice(0, 240) });
      }
    } catch (e) {
      out.failures.push({ source: s.id, url: 'arxiv', error: String(e.message || e) });
    }
  }
  return out;
}

export const COLLECTORS = { rss: collectRss, github: collectGithub, arxiv: collectArxiv };
