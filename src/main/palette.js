'use strict';

const { clipboard, net } = require('electron');
const { ctx } = require('./context');
const omnibox = require('./omnibox');
const { engine, searchUrl } = require('./search-engines');
const bookmarks = require('./bookmarks');
const workspaces = require('./workspaces');
const { ACTIONS, run: runAction, shortcutLabel } = require('./actions');
const { NEWTAB } = require('./tab');
const { tr, locale } = require('./i18n');

function matches(hay, words) {
  const h = (hay || '').toLowerCase();
  return words.every((w) => h.includes(w));
}

function formatNumber(n) {
  return Math.abs(n) >= 1e15 || (Math.abs(n) < 1e-6 && n !== 0) ? n.toExponential(6) : n.toLocaleString(locale(), { maximumFractionDigits: 10 });
}

function tabItem(win, t) {
  const ws = win.isPrivate ? null : ctx.workspace(t.workspaceId);
  const where = ws && ctx.workspaces().length > 1 ? `${ws.name} · ` : '';
  return { type: 'tab', id: t.id, title: t.title || tr('New Tab'), subtitle: `${where}${omnibox.displayUrl(t.displayUrl) || tr('New Tab')}`, favicon: t.favicon, dedupe: t.displayUrl };
}

function commandItems(words, limit, includeHidden = false) {
  return Object.entries(ACTIONS)
    .filter(([, a]) => (includeHidden || !a.hidden) && matches(`${a.title} ${tr(a.title, a.vars)}`, words))
    .slice(0, limit)
    .map(([id, a]) => ({ type: 'command', id, title: tr(a.title, a.vars), subtitle: shortcutLabel(id) }));
}

function query(win, text, mode) {
  if (mode === 'prompt') return [];
  const q = (text || '').trim();
  const results = [];
  const seen = new Set();
  const push = (item) => {
    const key = item.url || item.dedupe ? `u:${item.url || item.dedupe}` : `${item.type}:${item.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push(item);
  };

  if (q.startsWith('>')) {
    const words = q.slice(1).toLowerCase().split(/\s+/).filter(Boolean);
    return commandItems(words, 30, true);
  }

  if (!q) {
    win
      .allTabs()
      .filter((t) => t !== win.activeTab())
      .sort((a, b) => b.lastActive - a.lastActive)
      .slice(0, 6)
      .forEach((t) => push(tabItem(win, t)));
    const cmds = commandItems([], 50);
    for (const id of ['newTab', 'split', 'newPrivateWindow', 'history', 'settings']) {
      const c = cmds.find((x) => x.id === id);
      if (c) push(c);
    }
    return results;
  }

  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const engineId = ctx.settings().searchEngine;
  const engineName = engine(engineId).name;

  const value = omnibox.calculate(q);
  if (value !== null) push({ type: 'calc', id: 'calc', title: `= ${formatNumber(value)}`, subtitle: tr('Press Enter to copy the result'), value: String(value) });

  const inline = mode !== 'prompt' && q.length > 1 && /^[^\s>!]+$/.test(q) && value === null ? ctx.history.complete(q) : null;
  if (inline) push({ type: 'url', title: inline.completion, subtitle: tr('Open website'), url: inline.url, complete: inline.completion });

  const cls = omnibox.classify(q, engineId);
  if (cls.type === 'url') push({ type: 'url', title: omnibox.displayUrl(cls.url) || cls.url, subtitle: tr('Open website'), url: cls.url });
  else if (cls.type === 'bang') push({ type: 'search', title: cls.query, subtitle: tr('Search {name}', { name: cls.name }), url: cls.url });
  else push({ type: 'search', title: q, subtitle: tr('Search with {name}', { name: engineName }), url: cls.url });

  let tabCount = 0;
  for (const t of win.allTabs()) {
    if (tabCount < 4 && matches(`${t.title} ${t.displayUrl}`, words)) {
      push(tabItem(win, t));
      tabCount++;
    }
  }
  if (!win.isPrivate) {
    for (const w of ctx.workspaces()) {
      if (w.id !== win.activeWorkspaceId && matches(`${w.name} workspace ${tr('Workspace')}`, words)) {
        push({ type: 'workspace', id: w.id, title: tr('Switch to {name}', { name: w.name }), subtitle: tr('Workspace') });
      }
    }
  }
  for (const b of bookmarks.search(q, 4)) push({ type: 'bookmark', title: b.title, subtitle: omnibox.displayUrl(b.url), url: b.url, favicon: b.favicon });
  for (const h of ctx.history.search(q, 6)) push({ type: 'history', title: h.title || omnibox.displayUrl(h.url), subtitle: omnibox.displayUrl(h.url), url: h.url, favicon: h.favicon });
  commandItems(words, 4).forEach(push);
  if (cls.type === 'url') push({ type: 'search', title: q, subtitle: tr('Search with {name}', { name: engineName }), url: searchUrl(engineId, q), dedupe: `search:${q}` });

  return results.slice(0, 14);
}

async function suggest(win, text) {
  const q = (text || '').trim();
  const { searchSuggestions, searchEngine } = ctx.settings();
  const endpoint = engine(searchEngine).suggest;
  if (!q || q.startsWith('>') || q.startsWith('!') || !searchSuggestions || win.isPrivate || !endpoint) return [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await net.fetch(endpoint.replace('%s', encodeURIComponent(q)), { signal: controller.signal, credentials: 'omit' });
    const data = await res.json();
    const list = Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];
    return list
      .map((s) => (typeof s === 'string' ? s : s?.phrase))
      .filter((s) => s && s.toLowerCase() !== q.toLowerCase())
      .slice(0, 5)
      .map((s) => ({ type: 'suggestion', title: s, subtitle: tr('Search with {name}', { name: engine(searchEngine).name }), url: searchUrl(searchEngine, s) }));
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function run(win, item, { mode = 'command', newTab = false } = {}) {
  if (!item) return;
  const active = win.activeTab();
  const onNewTabPage = active && active.url.startsWith(NEWTAB);
  const openInNewTab = newTab || (mode === 'command' && !onNewTabPage);

  switch (item.type) {
    case 'url':
    case 'search':
    case 'suggestion':
    case 'history':
    case 'bookmark':
      win.closePalette();
      win.openUrl(item.url, { newTab: openInNewTab, typed: true });
      break;
    case 'tab':
      win.closePalette();
      win.activate(item.id);
      break;
    case 'workspace':
      win.closePalette();
      win.switchWorkspace(item.id);
      break;
    case 'command':
      win.closePalette();
      runAction(item.id, win);
      break;
    case 'calc':
      clipboard.writeText(item.value);
      win.closePalette();
      break;
    case 'prompt':
      win.closePalette();
      if (item.action === 'newWorkspace') {
        const ws = workspaces.create(item.value);
        win.switchWorkspace(ws.id);
      } else if (item.action?.startsWith('renameWorkspace:')) {
        workspaces.rename(item.action.split(':')[1], item.value);
      }
      break;
  }
}

module.exports = { query, suggest, run };
