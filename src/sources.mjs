// src/sources.mjs —— 信源适配器：rss / github(releases|commits) / arxiv / web(跳过)
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { httpText, httpJson, parseFeed, hasBreaking } from './lib.mjs';

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

/* ---------- GitHub：releases / commits ---------- */

const SKIP_COMMIT = /^(Merge\b|Revert\b|chore(\(|:)|docs(\(|:)|ci(\(|:)|test(\(|:)|style(\(|:)|build(\(|:))/i;

const ghHeaders = (token) => ({
  accept: 'application/vnd.github+json',
  ...(token ? { authorization: `Bearer ${token}` } : {}),
});

async function ghReleases(s, { dryRun, root, token }) {
  if (dryRun) return JSON.parse(await fixture('github.json', root));
  const { data } = await httpJson(`https://api.github.com/repos/${s.repo}/releases?per_page=5`, {
    headers: ghHeaders(token),
  });
  return data;
}

async function ghCommits(s, { dryRun, root, token, since }) {
  if (dryRun) return JSON.parse(await fixture('github-commits.json', root));
  const { data } = await httpJson(
    `https://api.github.com/repos/${s.repo}/commits?since=${encodeURIComponent(since)}&per_page=30`,
    { headers: ghHeaders(token) }
  );
  return data;
}

export async function collectGithub(cfg, opts = {}) {
  const out = { items: [], failures: [], tried: 0, ok: 0, rate: null };
  const token = process.env.GITHUB_TOKEN;
  const days = Number(opts.days ?? 3);
  const since = new Date(Date.now() - days * 86400000).toISOString();

  for (const s of cfg.sources || []) {
    if (s.type !== 'github') continue;
    const kind = s.kind || 'releases';
    out.tried++;
    try {
      if (kind === 'commits') {
        const commits = await ghCommits(s, { dryRun: opts.dryRun, root: opts.root, token, since });
        out.ok++;
        for (const c of Array.isArray(commits) ? commits : []) {
          const msg = String(c.commit?.message || '').split('\n')[0].trim();
          if (!msg || SKIP_COMMIT.test(msg)) continue; // merge/chore/docs/ci 不进简报
          out.items.push({
            title: `${s.name} ${String(c.sha || '').slice(0, 7)} ${msg}`.slice(0, 90),
            url: c.html_url,
            date: c.commit?.author?.date,
            summary: String(c.commit?.message || '').replace(/\s+/g, ' ').slice(0, 240),
            org: s.name,
            level: s.level,
            source: s.id,
            breaking: hasBreaking(msg),
          });
        }
      } else {
        const rels = await ghReleases(s, { dryRun: opts.dryRun, root: opts.root, token });
        out.ok++;
        for (const r of Array.isArray(rels) ? rels : []) {
          if (r.draft) continue;
          const bodyText = String(r.body || '');
          out.items.push({
            title: `${s.name} ${r.tag_name || r.name || ''}`.trim(),
            url: r.html_url,
            date: r.published_at,
            summary: (r.name ? r.name + '. ' : '') + bodyText.replace(/\s+/g, ' ').slice(0, 260),
            org: s.name,
            level: s.level,
            source: s.id,
            breaking: hasBreaking(bodyText),
          });
        }
      }
    } catch (e) {
      out.failures.push({ source: s.id, url: `github:${s.repo}`, error: String(e.message || e) });
      if (e.headers?.['x-ratelimit-remaining']) out.rate = e.headers['x-ratelimit-remaining'];
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
