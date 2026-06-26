import { fetchText } from './http.js';

export const YNET_FEED_URL = 'https://www.ynet.co.il/Integration/StoryRss2.xml';

export interface FeedItem {
  url: string;
  title: string;
  tags: string[];
}

export async function fetchFeed(url: string = YNET_FEED_URL): Promise<FeedItem[]> {
  return parseFeed(await fetchText(url));
}

export function parseFeed(xml: string): FeedItem[] {
  return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)]
    .map((m) => toFeedItem(m[1]))
    .filter((item): item is FeedItem => item !== null);
}

function toFeedItem(block: string): FeedItem | null {
  const url = elementText(block, 'link');
  if (!url || !isHttpUrl(url)) return null;
  return {
    url,
    title: elementText(block, 'title') ?? '',
    tags: parseTags(elementText(block, 'tags')),
  };
}

function parseTags(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

function elementText(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? stripCdata(m[1]).trim() : undefined;
}

function stripCdata(s: string): string {
  const m = s.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return m ? m[1] : s;
}

function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}
