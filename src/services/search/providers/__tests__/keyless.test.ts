import {extractAnchors} from '../keylessHtml';
import {KeylessProvider} from '../keyless';
import {
  buildEngineUrl,
  getKeylessEngines,
  hostOf,
  setKeylessEngines,
} from '../keylessEngines';

const html = `
<html><body>
<a href="https://search.brave.com/about">About Brave</a>
<a class="result" href="https://example.com/first"><span>First Real Result</span></a>
<a href="https://example.com/second">Second Result Here</a>
<a href="https://example.com/first">First Real Result</a>
<a href="https://example.com/x">x</a>
</body></html>`;

describe('extractAnchors', () => {
  it('keeps off-host anchors, drops engine links, dupes, and junk', () => {
    const hits = extractAnchors(html, 'search.brave.com');
    expect(hits.map(h => h.url)).toEqual([
      'https://example.com/first',
      'https://example.com/second',
    ]);
    expect(hits[0].title).toBe('First Real Result');
  });
});

describe('keylessEngines', () => {
  afterEach(() => {
    setKeylessEngines([]);
  });

  it('defaults to Brave + Ecosia templates', () => {
    expect(getKeylessEngines().length).toBe(2);
  });

  it('builds query URLs and host filters', () => {
    expect(buildEngineUrl('https://x.example/s?q={q}', 'a b')).toBe(
      'https://x.example/s?q=a%20b',
    );
    expect(hostOf('https://x.example/s?q={q}')).toBe('x.example');
  });

  it('accepts custom engines and drops invalid lines', () => {
    setKeylessEngines(['not a url', 'https://marginalia-search.com/search?query={q}']);
    expect(getKeylessEngines()).toEqual([
      'https://marginalia-search.com/search?query={q}',
    ]);
  });
});

describe('KeylessProvider', () => {
  beforeEach(() => {
    setKeylessEngines([]);
    global.fetch = jest.fn();
  });

  it('uses HTML hits when the primary succeeds', async () => {
    (global.fetch as jest.Mock).mockReturnValue(
      Promise.resolve({
        ok: true,
        status: 200,
        headers: {get: () => null},
        text: () => Promise.resolve(html),
      }),
    );
    const provider = new KeylessProvider(() => '');
    const hits = await provider.search('q', {maxResults: 5});
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].url).toContain('example.com');
  });

  it('falls back to open data when HTML engines fail', async () => {
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('brave.com') || url.includes('ecosia.org')) {
        return Promise.resolve({ok: false, status: 429});
      }
      if (url.includes('gdeltproject')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: {get: () => null},
          text: () =>
            Promise.resolve(
              JSON.stringify({
                articles: [{url: 'https://news.example/n', title: 'News Hit'}],
              }),
            ),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: {get: () => null},
        text: () => Promise.resolve(JSON.stringify({query: {search: []}})),
      });
    });
    const provider = new KeylessProvider(() => '');
    const hits = await provider.search('q', {maxResults: 5});
    expect(hits).toEqual([
      {title: 'News Hit', url: 'https://news.example/n', snippet: ''},
    ]);
  });
});
