'use strict';

const PAGE = 100;
let query = '';
let offset = 0;
let done = false;
let loading = false;
let lastDay = null;
let dayCard = null;

const list = document.getElementById('list');
const more = document.getElementById('more');

function emptyState(text) {
  return el('div', { class: 'empty-state' }, el('div', { class: 'empty-icon', html: icon('history', 40) }), el('div', {}, text));
}

function item(v) {
  const remove = el('button', { class: 'icon-btn', title: 'Remove from history', html: icon('x', 15) });
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
    list.textContent = '';
  }
  const visits = await api.call('historyList', { query, limit: PAGE, offset });
  offset += visits.length;
  done = visits.length < PAGE;
  for (const v of visits) {
    const day = dayLabel(v.time);
    if (day !== lastDay) {
      lastDay = day;
      list.append(el('div', { class: 'day' }, day));
      dayCard = el('div', { class: 'card' });
      list.append(dayCard);
    }
    dayCard.append(item(v));
  }
  if (!list.children.length) list.append(emptyState(query ? `Nothing in your history matches “${query}”.` : 'Pages you visit will show up here.'));
  loading = false;
}

const search = el('input', { type: 'search', class: 'search-input', placeholder: 'Search history', autofocus: true });
search.addEventListener('input', debounce(() => {
  query = search.value.trim();
  load(true);
}, 200));
document.getElementById('search-box').append(search);

const range = el(
  'select',
  { title: 'Clear history' },
  el('option', { value: '' }, 'Clear history…'),
  el('option', { value: 'hour' }, 'Last hour'),
  el('option', { value: 'day' }, 'Last 24 hours'),
  el('option', { value: 'week' }, 'Last 7 days'),
  el('option', { value: 'all' }, 'Everything'),
);
range.addEventListener('change', async () => {
  if (!range.value) return;
  await api.call('historyClear', range.value);
  range.value = '';
  toast('History cleared');
  load(true);
});
document.getElementById('actions').append(range);

new IntersectionObserver((entries) => entries[0].isIntersecting && load()).observe(more);
more.style.height = '1px';

initPage();
load(true);
