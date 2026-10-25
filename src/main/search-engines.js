'use strict';

const ENGINES = {
  google: {
    name: 'Google',
    search: 'https://www.google.com/search?q=%s',
    suggest: 'https://suggestqueries.google.com/complete/search?client=firefox&q=%s',
  },
  duckduckgo: {
    name: 'DuckDuckGo',
    search: 'https://duckduckgo.com/?q=%s',
    suggest: 'https://duckduckgo.com/ac/?q=%s&type=list',
  },
  bing: {
    name: 'Bing',
    search: 'https://www.bing.com/search?q=%s',
    suggest: 'https://api.bing.com/osjson.aspx?query=%s',
  },
  brave: {
    name: 'Brave Search',
    search: 'https://search.brave.com/search?q=%s',
    suggest: 'https://search.brave.com/api/suggest?q=%s',
  },
  ecosia: {
    name: 'Ecosia',
    search: 'https://www.ecosia.org/search?q=%s',
    suggest: 'https://ac.ecosia.org/autocomplete?q=%s&type=list',
  },
  startpage: {
    name: 'Startpage',
    search: 'https://www.startpage.com/sp/search?query=%s',
    suggest: null,
  },
  qwant: {
    name: 'Qwant',
    search: 'https://www.qwant.com/?q=%s',
    suggest: null,
  },
  yahoo: {
    name: 'Yahoo',
    search: 'https://search.yahoo.com/search?p=%s',
    suggest: null,
  },
};

const BANGS = {
  g: { name: 'Google', url: 'https://www.google.com/search?q=%s' },
  ddg: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
  yt: { name: 'YouTube', url: 'https://www.youtube.com/results?search_query=%s' },
  w: { name: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Special:Search?search=%s' },
  wde: { name: 'Wikipedia (DE)', url: 'https://de.wikipedia.org/wiki/Spezial:Suche?search=%s' },
  gh: { name: 'GitHub', url: 'https://github.com/search?q=%s' },
  r: { name: 'Reddit', url: 'https://www.reddit.com/search/?q=%s' },
  so: { name: 'Stack Overflow', url: 'https://stackoverflow.com/search?q=%s' },
  mdn: { name: 'MDN', url: 'https://developer.mozilla.org/en-US/search?q=%s' },
  npm: { name: 'npm', url: 'https://www.npmjs.com/search?q=%s' },
  maps: { name: 'Google Maps', url: 'https://www.google.com/maps/search/%s' },
  img: { name: 'Image search', url: 'https://duckduckgo.com/?q=%s&iax=images&ia=images' },
  tr: { name: 'DeepL', url: 'https://www.deepl.com/translator#auto/en/%s' },
  amz: { name: 'Amazon', url: 'https://www.amazon.de/s?k=%s' },
};

let custom = null;

function setCustomEngine(name, url) {
  custom = isValidTemplate(url) ? { name: (name || '').trim() || require('./i18n').tr('Custom search'), search: url.trim(), suggest: null } : null;
}

function isValidTemplate(url) {
  return typeof url === 'string' && /^https?:\/\/\S+$/i.test(url.trim()) && url.includes('%s');
}

function engine(id) {
  if (id === 'custom' && custom) return custom;
  return ENGINES[id] || ENGINES.google;
}

function list() {
  const all = Object.entries(ENGINES).map(([id, e]) => ({ id, name: e.name }));
  if (custom) all.push({ id: 'custom', name: custom.name });
  return all;
}

function fill(template, query) {
  return template.replace('%s', encodeURIComponent(query));
}

function searchUrl(engineId, query) {
  return fill(engine(engineId).search, query);
}

function parseBang(input) {
  const m = input.trim().match(/^!(\w+)\s+(.+)$/) || input.trim().match(/^(.+?)\s+!(\w+)$/);
  if (!m) return null;
  const [key, query] = input.trim().startsWith('!') ? [m[1], m[2]] : [m[2], m[1]];
  const bang = BANGS[key.toLowerCase()];
  if (!bang) return null;
  return { bang: key.toLowerCase(), name: bang.name, query, url: fill(bang.url, query) };
}

module.exports = { ENGINES, BANGS, engine, list, searchUrl, parseBang, setCustomEngine, isValidTemplate };
