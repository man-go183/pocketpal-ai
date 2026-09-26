import type {SearchProvider, SearchHit, SearchOptions} from '../types';
import {searchKeylessHtml} from './keylessHtml';
import {searchOpenData} from './opendata';

/**
 * Keyless cascade, no API key: HTML result pages first (Brave + Ecosia),
 * stable data APIs (GDELT + Wikipedia) only when the primary comes back
 * empty. One provider id so budgeting/caching treat it as a single source.
 */
export class KeylessProvider implements SearchProvider {
  readonly id = 'keyless' as const;

  constructor(private _getKey: () => string) {}

  async search(query: string, opts: SearchOptions): Promise<SearchHit[]> {
    let primary: SearchHit[] = [];
    try {
      primary = await searchKeylessHtml(query, opts.maxResults);
    } catch {
      primary = [];
    }
    if (primary.length > 0) {
      return primary.slice(0, opts.maxResults);
    }
    return searchOpenData(query, opts.maxResults);
  }
}
