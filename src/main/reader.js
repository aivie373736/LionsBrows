'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const WORLD = 1010;
const PREFIX = 'lions://reader/';
const LIB = path.dirname(require.resolve('@mozilla/readability/package.json'));
const sources = {};
const articles = new Map();
const CLUTTER = ['.infobox', '.navbox', '.vertical-navbox', '.sidebar', '.metadata', '.ambox', '.hatnote', '.mw-editsection', '.noprint', '.reference', '.shortdescription', '#toc', '.toc'].join(', ');

function source(file) {
  if (!sources[file]) sources[file] = fs.readFileSync(path.join(LIB, file), 'utf8');
  return sources[file];
}

function sourceUrl(url) {
  if (!url || !url.startsWith(PREFIX)) return null;
  try {
    const target = new URL(url).searchParams.get('url');
    return target && /^https?:/i.test(target) ? target : null;
  } catch {
    return null;
  }
}

async function check(tab) {
  const wc = tab.wc;
  if (!wc || !/^https?:/i.test(wc.getURL())) return false;
  const code = `${source('Readability-readerable.js')}\n;isProbablyReaderable(document, { minContentLength: 140, minScore: 20 })`;
  try {
    return Boolean(await wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code }]));
  } catch {
    return false;
  }
}

async function open(tab) {
  const wc = tab.wc;
  if (!wc) return false;
  const url = wc.getURL();
  if (!/^https?:/i.test(url)) return false;
  const code = `${source('Readability.js')}
;(() => {
  const doc = document.cloneNode(true);
  doc.querySelectorAll(${JSON.stringify(CLUTTER)}).forEach((node) => node.remove());
  const a = new Readability(doc, { charThreshold: 300 }).parse();
  return a && { title: a.title, byline: a.byline, siteName: a.siteName, content: a.content, length: a.length, lang: a.lang, dir: a.dir, publishedTime: a.publishedTime };
})()`;
  let article = null;
  try {
    article = await wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code }]);
  } catch {
    return false;
  }
  if (!article || !article.content) return false;
  const id = crypto.randomUUID();
  articles.set(id, { ...article, url, favicon: tab.favicon || '' });
  while (articles.size > 20) articles.delete(articles.keys().next().value);
  tab.navigate(`${PREFIX}?id=${id}&url=${encodeURIComponent(url)}`);
  return true;
}

function exit(tab) {
  const target = sourceUrl(tab.url);
  if (!target || !tab.wc) return;
  const h = tab.wc.navigationHistory;
  const index = h.getActiveIndex();
  if (index > 0 && h.getEntryAtIndex(index - 1)?.url === target) h.goBack();
  else tab.navigate(target);
}

function toggle(tab) {
  if (!tab) return;
  if (sourceUrl(tab.url)) exit(tab);
  else open(tab);
}

function article(id) {
  return articles.get(String(id)) || null;
}

module.exports = { check, open, exit, toggle, article, sourceUrl };
