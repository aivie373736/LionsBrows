'use strict';

const PAGE = 100;
let query = '';
let offset = 0;
let done = false;
let loading = false;
let lastDay = null;
let lastUrl = null;
let dayCard = null;

const list = document.getElementById('list');
const more = document.getElementById('more');
const search = libraryShell('history', 'Search history');

function item(v) {
  const remove = el('button', { class: 'icon-btn', title: tr('Remove from history'), 'aria-label': tr('Remove from history'), html: icon('x', 16) });
  const row = el(
    'div',
    { class: 'list-item' },
    el('span', { class: 'time' }, timeLabel(v.time)),
    faviconEl(v.favicon),
    el('a', { class: 'title', href: v.url, title: v.url }, v.title || hostOf(v.url)),
    el('span', { class: 'host' }, hostOf(v.url)),
    remove,
  );
  remove.onclick = async () => {
    await api.call('historyDelete', v.url);
    document.querySelectorAll('.list-item').forEach((r) => r.querySelector('a.title')?.getAttribute('href') === v.url && r.remove());
  };
  return row;
}

async function load(reset = false) {
  if (loading || (done && !reset)) return;
  loading = true;
  if (reset) {
    offset = 0;
    done = false;
    lastDay = null;
    lastUrl = null;
    list.textContent = '';
  }
  const visits = await api.call('historyList', { query, limit: PAGE, offset });
  offset += visits.length;
  done = visits.length < PAGE;
  for (const v of visits) {
    const day = dayLabel(v.time);
    if (day !== lastDay) {
      lastDay = day;
      lastUrl = null;
      dayCard = el('div', { class: 'card' });
      list.append(libraryPanel(day, dayCard));
    }
    if (v.url === lastUrl) continue;
    lastUrl = v.url;
    dayCard.append(item(v));
  }
  if (!list.children.length) list.append(emptyPanel('history', query ? tr('No history matches “{query}”.', { query }) : tr('Pages you visit will appear here.')));
  loading = false;
}

search.addEventListener(
  'input',
  debounce(() => {
    query = search.value.trim();
    load(true);
  }, 200),
);

const range = el(
  'select',
  { title: tr('Clear history'), 'aria-label': tr('Clear history') },
  el('option', { value: '' }, tr('Clear history…')),
  el('option', { value: 'hour' }, tr('Last hour')),
  el('option', { value: 'day' }, tr('Last 24 hours')),
  el('option', { value: 'week' }, tr('Last 7 days')),
  el('option', { value: 'all' }, tr('All time')),
);
range.addEventListener('change', async () => {
  if (!range.value) return;
  await api.call('historyClear', range.value);
  range.value = '';
  toast(tr('History cleared'));
  load(true);
});
document.getElementById('actions').append(range);

new IntersectionObserver((entries) => entries[0].isIntersecting && load()).observe(more);
more.style.height = '1px';

initPage();
load(true);
