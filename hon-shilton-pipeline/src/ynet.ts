// ynet scraper: fetch an article page and pull the clean text out of its
// JSON-LD (schema.org Article). No fragile DOM scraping — ynet embeds an
// `articleBody`. Premium/paywalled articles are detected and skipped.

import type { ArticleInput } from './types.js';

const USER_AGENT = 'Mozilla/5.0 (HonShilton research bot; +contact: admin@wotch.health)';
const TIMEOUT_MS = 25_000;

export interface FetchResult {
  status: 'ok' | 'premium_skipped' | 'error';
  article?: ArticleInput;
  reason?: string;
}

export async function fetchArticle(url: string, opts?: { tags?: string[] }): Promise<FetchResult> {
  let html: string;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return { status: 'error', reason: `HTTP ${res.status}` };
    html = await res.text();
  } catch (err) {
    return { status: 'error', reason: (err as Error).message };
  }

  return parseArticle(html, url, opts);
}

// Pure parser (no network): pull the article out of page HTML via JSON-LD.
export function parseArticle(html: string, url: string, opts?: { tags?: string[] }): FetchResult {
  const ld = extractArticleLd(html);
  if (!ld) return { status: 'error', reason: 'no JSON-LD Article block found' };
  if (isPremium(ld)) return { status: 'premium_skipped', reason: 'isAccessibleForFree=false' };
  if (!ld.articleBody) return { status: 'premium_skipped', reason: 'no articleBody (likely premium/locked)' };

  const article: ArticleInput = {
    url,
    title: clean(String(ld.headline ?? '')),
    body: clean(String(ld.articleBody)),
    outlet: 'ynet',
    publishedDate: typeof ld.datePublished === 'string' ? ld.datePublished : undefined,
    author: authorName(ld.author),
    tags: opts?.tags,
  };
  return { status: 'ok', article };
}

// --- JSON-LD helpers ---

/* eslint-disable @typescript-eslint/no-explicit-any */
function extractArticleLd(html: string): any | null {
  const blocks = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const m of blocks) {
    let json: any;
    try {
      json = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const found = findArticle(json);
    if (found) return found;
  }
  return null;
}

function findArticle(node: any): any | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const x of node) {
      const f = findArticle(x);
      if (f) return f;
    }
    return null;
  }
  if (node['@graph']) {
    const f = findArticle(node['@graph']);
    if (f) return f;
  }
  const type = node['@type'];
  const isArticle = type && (Array.isArray(type) ? type.some(isArticleType) : isArticleType(String(type)));
  if (isArticle && (node.articleBody || node.isAccessibleForFree !== undefined || node.headline)) return node;
  return null;
}

function isArticleType(t: string): boolean {
  return /Article$/i.test(t) || /Article/i.test(t); // NewsArticle, ReportageNewsArticle, Article, ...
}

function isPremium(ld: any): boolean {
  const v = ld?.isAccessibleForFree;
  return v === false || v === 'False' || v === 'false';
}

function authorName(a: any): string | undefined {
  if (!a) return undefined;
  if (typeof a === 'string') return a;
  if (Array.isArray(a)) return a.map(authorName).filter(Boolean).join(', ') || undefined;
  if (typeof a === 'object' && a.name) return String(a.name);
  return undefined;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Strip stray tags / decode the few entities that show up in ynet bodies,
// collapse whitespace. Hebrew text passes through untouched.
function clean(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
