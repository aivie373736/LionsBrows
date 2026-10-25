'use strict';

let query = '';
const list = document.getElementById('list');
const search = libraryShell('bookmarks', 'Search bookmarks');

function editable(span, onSave) {
  span.title = 'Double-click to edit';
  span.addEventListener('dblclick', (e) => {
    e.preventDefault();
    span.contentEditable = 'plaintext-only';
    span.focus();
    document.getSelection().selectAllChildren(span);
  });
  span.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      span.blur();
    }
  });
  span.addEventListener('blur', () => {
    if (span.contentEditable !== 'plaintext-only') return;
    span.contentEditable = 'false';
    onSave(span.textContent.trim());
  });
}

function row(b) {
  const title = el('a', { class: 'title', href: b.url }, b.title || hostOf(b.url));
  editable(title, (value) => value && value !== b.title && api.call('bookmarksUpdate', b.id, { title: value }));
  title.addEventListener('click', (e) => title.isContentEditable && e.preventDefault());
  return el(
    'div',
    { class: 'list-item' },
    faviconEl(b.favicon),
    title,
    el('span', { class: 'host' }, hostOf(b.url)),
    el('button', { class: 'icon-btn', title: 'Move to folder', 'aria-label': 'Move to folder', html: icon('folder-open', 16), onclick: () => moveToFolder(b) }),
    el('button', { class: 'icon-btn', title: 'Delete bookmark', 'aria-label': 'Delete bookmark', html: icon('trash-2', 16), onclick: () => api.call('bookmarksRemove', b.id) }),
  );
}

function moveToFolder(b) {
  const form = el('form', { class: 'row', style: 'gap:10px' });
  const input = el('input', { type: 'text', placeholder: 'Folder name (leave empty for none)', value: b.folder || '', style: 'flex:1' });
  form.append(input, el('button', { class: 'button primary', type: 'submit' }, 'Move'), el('button', { class: 'button', type: 'button', onclick: () => render() }, 'Cancel'));
  form.onsubmit = (e) => {
    e.preventDefault();
    api.call('bookmarksUpdate', b.id, { folder: input.value.trim() });
  };
  list.prepend(libraryPanel(`Move “${b.title || hostOf(b.url)}”`, el('div', { class: 'card' }, form)));
  input.focus();
}

async function render() {
  const all = await api.call('bookmarksList');
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const items = all.filter((b) => words.every((w) => `${b.title} ${b.url} ${b.folder}`.toLowerCase().includes(w)));
  list.textContent = '';
  if (!items.length) {
    list.append(emptyPanel('bookmark', query ? `No bookmarks match “${query}”.` : 'Press Ctrl+D (⌘D on Mac) or select the star in the address bar to bookmark a page.'));
    return;
  }
  const folders = new Map();
  for (const b of items) {
    const f = b.folder || '';
    if (!folders.has(f)) folders.set(f, []);
    folders.get(f).push(b);
  }
  const names = [...folders.keys()].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
  for (const name of names) {
    list.append(libraryPanel(`${name || 'Unsorted'} (${folders.get(name).length})`, el('div', { class: 'card' }, ...folders.get(name).map(row))));
  }
}

search.addEventListener(
  'input',
  debounce(() => {
    query = search.value.trim();
    render();
  }, 150),
);

const importBtn = el('button', { class: 'button' }, 'Import');
importBtn.title = 'Import an HTML bookmarks file exported from Chrome, Firefox, Edge or Safari';
importBtn.onclick = async () => {
  const n = await api.call('bookmarksImport');
  if (n) toast(`Imported ${n} bookmark${n === 1 ? '' : 's'}`);
};
const exportBtn = el('button', { class: 'button' }, 'Export');
exportBtn.onclick = async () => {
  if (await api.call('bookmarksExport')) toast('Bookmarks exported');
};
document.getElementById('actions').append(importBtn, exportBtn);

api.on((name) => name === 'bookmarks-changed' && render());
initPage();
render();
