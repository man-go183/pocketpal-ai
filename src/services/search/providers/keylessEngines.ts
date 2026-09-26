/**
 * Editable search-page list for the keyless provider. Each entry is a result-
 * page URL template with `{q}` where the query goes. The generic anchor
 * extractor works on any HTML, so new engines are just new lines — no code.
 */
export const DEFAULT_KEYLESS_ENGINES = [
  'https://search.brave.com/search?q={q}',
  'https://www.ecosia.org/search?q={q}',
];

let override: string[] | null = null;

const isValidTemplate = (tpl: string): boolean => {
  try {
    const url = new URL(tpl.replace('{q}', 'test'));
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (e) {
    return false;
  }
};

export const setKeylessEngines = (urls: string[]): void => {
  const clean = urls.map(u => u.trim()).filter(u => u && isValidTemplate(u));
  override = clean.length > 0 ? clean : null;
};

export const getKeylessEngines = (): string[] =>
  override && override.length > 0 ? override : DEFAULT_KEYLESS_ENGINES;

export const parseEnginesText = (text: string): string[] =>
  text
    .split('\n')
    .map(u => u.trim())
    .filter(u => u.length > 0);

export const buildEngineUrl = (template: string, query: string): string =>
  template.includes('{q}')
    ? template.replace('{q}', encodeURIComponent(query))
    : template + encodeURIComponent(query);

export const hostOf = (template: string): string => {
  try {
    return new URL(template.replace('{q}', 'test')).hostname;
  } catch (e) {
    return '';
  }
};
