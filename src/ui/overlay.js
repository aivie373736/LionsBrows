'use strict';

const $ = (sel) => document.querySelector(sel);
const call = (name, ...args) => window.lions.overlay(name, ...args);
const isMac = window.lions.platform === 'darwin';

const input = $('#q');
const results = $('#results');
const LOGO = '../shared/logo.svg';

let mode = 'command';
let prompt = null;
let items = [];
let suggestions = [];
let selected = 0;
let seq = 0;
let suggestTimer = null;
let typed = '';
let completing = false;

const TYPE_ICON = {
  url: 'globe',
  search: 'search',
  suggestion: 'search',
  history: 'history',
  bookmark: 'star',
  tab: 'layers',
  command: 'zap',
  calc: 'calculator',
  workspace: 'layers',
};
const TYPE_BADGE = {
  tab: tr('Switch to tab'),
  workspace: tr('Switch'),
  url: tr('Open'),
  calc: tr('Copy'),
};

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function allItems() {
  const i = items.findIndex((x) => x.type === 'search');
  if (!suggestions.length) return items;
  const at = i === -1 ? items.length : i + 1;
  return [...items.slice(0, at), ...suggestions, ...items.slice(at)];
}

function render() {
  const list = allItems();
  results.textContent = '';
  if (selected >= list.length) selected = Math.max(0, list.length - 1);
  let lastGroup = null;
  list.forEach((item, i) => {
    const group = !input.value.trim() ? (item.type === 'tab' ? tr('Recent tabs') : tr('Quick actions')) : null;
    if (group && group !== lastGroup) {
      results.append(el('div', 'group', group));
      lastGroup = group;
    }
    const row = el('div', `item ${item.type}${i === selected ? ' sel' : ''}`);
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(i === selected));
    const ico = el('span', 'ico');
    if (item.favicon) {
      const img = document.createElement('img');
      img.src = item.favicon;
      img.referrerPolicy = 'no-referrer';
      img.onerror = () => (ico.innerHTML = icon(TYPE_ICON[item.type] || 'globe', 16));
      ico.append(img);
    } else if (item.subtitle && item.subtitle.startsWith('lions://')) {
      ico.innerHTML = `<img src="${LOGO}" alt="">`;
    } else {
      ico.innerHTML = icon(TYPE_ICON[item.type] || 'globe', 16);
    }
    const text = el('span', 'text');
    text.append(el('span', 'title', item.title), el('span', 'subtitle', item.subtitle || ''));
    row.append(ico, text);
    if (item.type !== 'command' && i === selected) {
      const isSearch = item.type === 'search' || item.type === 'suggestion';
      row.append(el('span', 'badge', TYPE_BADGE[item.type] || (isSearch ? tr('Search') : tr('Open'))));
    }
    row.addEventListener('mousemove', () => {
      if (selected !== i) {
        selected = i;
        render();
      }
    });
    row.addEventListener('click', (e) => choose(item, e.shiftKey || e.altKey || e.metaKey || e.ctrlKey));
    results.append(row);
  });
  results.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
}

function applyCompletion() {
  const completion = items[0] && items[0].complete;
  if (!completing || !completion || input.value !== typed || input.selectionStart !== typed.length || input.selectionEnd !== typed.length) return false;
  if (completion.length <= typed.length || !completion.toLowerCase().startsWith(typed.toLowerCase())) return false;
  input.value = typed + completion.slice(typed.length);
  input.setSelectionRange(typed.length, input.value.length);
  return true;
}

async function refresh() {
  const text = mode === 'prompt' ? input.value : typed;
  const mySeq = ++seq;
  if (mode === 'prompt') {
    items = [];
    suggestions = [];
    render();
    return;
  }
  const found = await call('query', text, mode);
  if (mySeq !== seq) return;
  items = found || [];
  suggestions = [];
  selected = 0;
  if (!applyCompletion() && items[0] && items[0].complete) selected = Math.min(1, items.length - 1);
  render();

  clearTimeout(suggestTimer);
  suggestTimer = setTimeout(async () => {
    const s = await call('suggest', text);
    if (mySeq !== seq) return;
    const known = new Set(items.map((x) => (x.title || '').toLowerCase()));
    suggestions = (s || []).filter((x) => !known.has(x.title.toLowerCase()));
    const current = allItems()[selected];
    render();
    const idx = allItems().indexOf(current);
    if (idx >= 0 && idx !== selected) {
      selected = idx;
      render();
    }
  }, 120);
}

function choose(item, newTab = false) {
  if (!item) return;
  call('run', item, { mode, newTab });
}

function submit(newTab) {
  if (mode === 'prompt') {
    if (!input.value.trim()) return;
    call('run', { type: 'prompt', action: prompt.action, value: input.value }, {});
    return;
  }
  choose(allItems()[selected], newTab);
}

input.addEventListener('input', (e) => {
  typed = input.value;
  completing = !String(e.inputType || '').startsWith('delete');
  refresh();
});
input.addEventListener('keydown', (e) => {
  const list = allItems();
  if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey) || (e.ctrlKey && e.key === 'n')) {
    e.preventDefault();
    selected = list.length ? (selected + 1) % list.length : 0;
    render();
  } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey) || (e.ctrlKey && e.key === 'p')) {
    e.preventDefault();
    selected = list.length ? (selected - 1 + list.length) % list.length : 0;
    render();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    submit(e.shiftKey || e.altKey || (isMac ? e.metaKey : e.ctrlKey));
  } else if (e.key === 'Escape') {
    e.preventDefault();
    call('close');
  }
});
$('#backdrop').addEventListener('mousedown', () => call('close'));

function setHints() {
  const hints =
    mode === 'prompt'
      ? [['Enter', tr('save')], ['Esc', tr('cancel')]]
      : [
          ['↑↓', tr('select')],
          ['Enter', tr('open')],
          ['Shift+Enter', tr('new tab')],
          ['>', tr('commands')],
          ['!yt', tr('bangs')],
          ['2+2', tr('math')],
        ];
  $('#hints').innerHTML = hints.map(([k, v]) => `<span><b>${k}</b> ${v}</span>`).join('');
}

window.lions.on('overlay:open', (opts) => {
  mode = opts.mode || 'command';
  prompt = mode === 'prompt' ? opts : null;
  if (!opts.isPrivate && opts.accent) document.documentElement.style.setProperty('--accent-base', opts.accent);
  document.documentElement.classList.toggle('private', Boolean(opts.isPrivate));
  document.documentElement.classList.toggle('dark', Boolean(opts.dark));
  $('#prompt-title').hidden = mode !== 'prompt';
  $('#prompt-title').textContent = prompt ? prompt.title : '';
  $('#lead').innerHTML = mode === 'prompt' ? icon('layers', 20) : mode === 'address' ? icon('globe', 20) : icon('search', 20);
  input.placeholder =
    mode === 'prompt' ? tr('Type a name') : mode === 'address' ? tr('Search or enter address') : tr('Search tabs, history and the web — or type > for commands');
  input.value = mode === 'prompt' ? opts.value || '' : opts.text || '';
  typed = input.value;
  completing = false;
  setHints();
  const p = $('#palette');
  p.style.animation = 'none';
  void p.offsetWidth;
  p.style.animation = '';
  input.focus();
  input.select();
  refresh();
});
