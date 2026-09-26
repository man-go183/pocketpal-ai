import type {SearchHit} from '../types';
import {fetchJson} from './http';

interface GdeltArticle {
  url?: string;
  title?: string;
  domain?: string;
  seendate?: string;
}

interface GdeltResponse {
  articles?: GdeltArticle[];
}

interface WikiSearchItem {
  title?: string;
  snippet?: string;
}

interface WikiResponse {
  query?: {search?: WikiSearchItem[]};
}

const stripTags = (s: string): string =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const searchGdelt = async (query: string): Promise<SearchHit[]> => {
  const data = await fetchJson<GdeltResponse>(
    `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(
      query,
    )}&mode=artlist&maxrecords=5&format=json`,
    {method: 'GET', headers: {Accept: 'application/json'}},
  );
  return (data.articles ?? [])
    .filter(a => a.url && a.title)
    .map(a => ({
      title: a.title as string,
      url: a.url as string,
      snippet: a.domain ? `via ${a.domain}` : '',
      ...(a.seendate ? {publishedAt: a.seendate} : {}),
    }));
};

const searchWiki = async (query: string): Promise<SearchHit[]> => {
  const data = await fetchJson<WikiResponse>(
    `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      query,
    )}&format=json&srlimit=3&origin=*`,
    {method: 'GET', headers: {Accept: 'application/json'}},
  );
  return (data.query?.search ?? [])
    .filter(s => s.title)
    .map(s => ({
      title: s.title as string,
      url:
        'https://en.wikipedia.org/wiki/' +
        encodeURIComponent((s.title as string).replace(/ /g, '_')),
      snippet: stripTags(s.snippet ?? '').slice(0, 280),
    }));
};

/**
 * Backup keyless search: stable JSON data APIs (news + encyclopedia).
 * Throws only when both fail; partial results are returned as-is.
 */
export const searchOpenData = async (
  query: string,
  maxResults: number,
): Promise<SearchHit[]> => {
  const errors: string[] = [];
  let merged: SearchHit[] = [];
  for (const fn of [searchGdelt, searchWiki]) {
    try {
      const hits = await fn(query);
      const seen = new Set(merged.map(h => h.url));
      for (const h of hits) {
        if (!seen.has(h.url)) {
          seen.add(h.url);
          merged.push(h);
        }
      }
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  if (merged.length === 0 && errors.length > 0) {
    throw new Error(`open-data backup failed (${errors.join('; ')})`);
  }
  return merged.slice(0, maxResults);
};
