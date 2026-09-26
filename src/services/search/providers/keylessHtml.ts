import type {SearchHit} from '../types';
import {fetchText} from './http';
import {
  buildEngineUrl,
  getKeylessEngines,
  hostOf,
} from './keylessEngines';

const stripTags = (s: string): string =>
  s
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

const isJunkTitle = (t: string): boolean => {
  if (t.length < 8 || t.length > 220) {
    return true;
  }
  if (/^(sign in|log in|accept|cookie|subscribe|follow|share|menu|search|home|next|more)$/i.test(t)) {
    return true;
  }
  if (/[›»]/.test(t)) {
    return true;
  }
  return false;
};

/**
 * Generic scored-anchor fallback: every off-host http(s) anchor is a
 * candidate; surrounding markup can't be relied on because engine layouts
 * change. Pure function so it can be unit-tested without network.
 */
export const extractAnchors = (html: string, host: string): SearchHit[] => {
  const out: SearchHit[] = [];
  const seen = new Set<string>();
  const re = /<a\b[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const url = new URL(m[1]);
      if (url.hostname === host || url.hostname.endsWith('.' + host)) {
        continue;
      }
      if (!/^(http|https):$/.test(url.protocol)) {
        continue;
      }
      const title = stripTags(m[2]);
      if (isJunkTitle(title)) {
        continue;
      }
      const key = (url.hostname + url.pathname).toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push({title, url: m[1], snippet: ''});
      if (out.length >= 12) {
        break;
      }
    } catch (e) {
      continue;
    }
  }
  return out;
};

const USER_AGENT =
  'Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';

const searchEnginePage = async (
  template: string,
  query: string,
): Promise<SearchHit[]> => {
  const html = await fetchText(buildEngineUrl(template, query), {
    headers: {Accept: 'text/html', 'User-Agent': USER_AGENT},
  });
  return extractAnchors(html, hostOf(template));
};

/**
 * Primary keyless search: Brave + Ecosia result pages, no key.
 * Throws when BOTH engines fail (transport/auth) so the cascade can fall
 * back; returns whatever acceptable hits were found otherwise (possibly few).
 */
export const searchKeylessHtml = async (
  query: string,
  maxResults: number,
): Promise<SearchHit[]> => {
  const errors: string[] = [];
  let merged: SearchHit[] = [];
  for (const template of getKeylessEngines()) {
    try {
      const hits = await searchEnginePage(template, query);
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
    if (merged.length >= maxResults) {
      break;
    }
  }
  if (merged.length === 0 && errors.length > 0) {
    throw new Error(`keyless HTML search failed (${errors.join('; ')})`);
  }
  return merged.slice(0, Math.max(maxResults * 2, maxResults));
};
