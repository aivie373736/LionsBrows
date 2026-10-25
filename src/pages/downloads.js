'use strict';

let query = '';
const list = document.getElementById('list');
const search = libraryShell('downloads', 'Search downloads');

function status(d) {
  if (d.state === 'progressing') return `${formatBytes(d.received)}${d.total ? ` of ${formatBytes(d.total)}` : ''}${d.paused ? ' · Paused' : ''}`;
  if (d.state === 'completed') return `${formatBytes(d.total || d.received)} · ${dayLabel(d.startTime)} ${timeLabel(d.startTime)}`;
  return d.state === 'cancelled' ? 'Canceled' : 'Failed';
}

function actionButton(d, act, iconName, title) {
  return el('button', { class: 'icon-btn', title, 'aria-label': title, html: icon(iconName, 16), onclick: () => api.call('downloadAction', d.id, act) });
}

function row(d) {
  const name = el('a', { class: 'title', href: '#', title: d.path || d.url }, d.filename);
  name.onclick = (e) => {
    e.preventDefault();
    api.call('downloadAction', d.id, 'open');
  };
  if (d.state !== 'completed' && d.state !== 'progressing') name.style.textDecoration = 'line-through';
  const actions =
    d.state === 'progressing'
      ? [d.paused ? actionButton(d, 'resume', 'play', 'Resume') : actionButton(d, 'pause', 'pause', 'Pause'), actionButton(d, 'cancel', 'x', 'Cancel')]
      : [d.state === 'completed' ? actionButton(d, 'show', 'folder-open', 'Show in folder') : null, actionButton(d, 'remove', 'trash-2', 'Remove from list')];
  return el('div', { class: 'list-item' }, el('span', { class: 'fav', html: icon('file', 16) }), name, el('span', { class: 'host' }, `${status(d)} · ${hostOf(d.url)}`), ...actions);
}

async function render() {
  const items = (await api.call('downloadsList')).filter((d) => !query || d.filename.toLowerCase().includes(query.toLowerCase()));
  list.textContent = '';
  if (!items.length) {
    list.append(emptyPanel('download', query ? 'No downloads match your search.' : 'Files you download will appear here.'));
    return;
  }
  list.append(libraryPanel(null, el('div', { class: 'card' }, ...items.map(row))));
}

search.addEventListener(
  'input',
  debounce(() => {
    query = search.value.trim();
    render();
  }, 150),
);

const clear = el('button', { class: 'button' }, 'Clear list');
clear.onclick = () => api.call('downloadAction', null, 'clear');
document.getElementById('actions').append(clear);

api.on((name) => name === 'downloads-changed' && render());
initPage();
render();
