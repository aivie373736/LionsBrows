'use strict';

let query = '';
const list = document.getElementById('list');

function status(d) {
  if (d.state === 'progressing') return `${formatBytes(d.received)}${d.total ? ` of ${formatBytes(d.total)}` : ''}${d.paused ? ' · Paused' : ''}`;
  if (d.state === 'completed') return `${formatBytes(d.total || d.received)} · ${dayLabel(d.startTime)} ${timeLabel(d.startTime)}`;
  return d.state === 'cancelled' ? 'Cancelled' : 'Failed';
}

function actionButton(d, act, ic, title) {
  return el('button', { class: 'icon-btn', title, html: icon(ic, 15), onclick: () => api.call('downloadAction', d.id, act) });
}

function row(d) {
  const name = el('a', { class: 'title', href: '#', title: d.path || d.url }, d.filename);
  name.onclick = (e) => {
    e.preventDefault();
    api.call('downloadAction', d.id, 'open');
  };
  if (d.state !== 'completed') name.style.textDecoration = d.state === 'progressing' ? '' : 'line-through';
  const acts =
    d.state === 'progressing'
      ? [d.paused ? actionButton(d, 'resume', 'play', 'Resume') : actionButton(d, 'pause', 'pause', 'Pause'), actionButton(d, 'cancel', 'x', 'Cancel')]
      : [d.state === 'completed' ? actionButton(d, 'show', 'folder-open', 'Show in folder') : null, actionButton(d, 'remove', 'trash-2', 'Remove from list')];
  return el('div', { class: 'list-item' }, el('span', { class: 'fav', html: icon('file', 16) }), name, el('span', { class: 'host' }, `${status(d)} · ${hostOf(d.url)}`), ...acts);
}

async function render() {
  const items = (await api.call('downloadsList')).filter((d) => !query || d.filename.toLowerCase().includes(query.toLowerCase()));
  list.textContent = '';
  if (!items.length) {
    list.append(el('div', { class: 'empty-state' }, el('div', { class: 'empty-icon', html: icon('download', 40) }), el('div', {}, query ? 'No downloads match.' : 'Files you download will show up here.')));
    return;
  }
  list.append(el('div', { class: 'card' }, ...items.map(row)));
}

const search = el('input', { type: 'search', class: 'search-input', placeholder: 'Search downloads', style: 'margin-bottom:18px' });
search.addEventListener('input', debounce(() => {
  query = search.value.trim();
  render();
}, 150));
document.getElementById('search-box').append(search);

const clear = el('button', { class: 'button' }, 'Clear list');
clear.onclick = () => api.call('downloadAction', null, 'clear');
document.getElementById('actions').append(clear);

api.on((name) => name === 'downloads-changed' && render());
initPage();
render();
