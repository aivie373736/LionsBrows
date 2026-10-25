'use strict';

const isMac = navigator.platform.toLowerCase().includes('mac');
const mod = isMac ? '⌘' : 'Ctrl+';

const TIPS = [
  `Press <kbd>${mod}K</kbd> anywhere to search tabs, history and commands.`,
  `Type <kbd>!yt cats</kbd> in the command bar to search YouTube directly.`,
  `Press <kbd>${mod}\\</kbd> to view two tabs side by side.`,
  `Drag a tab onto the top of the sidebar to pin it.`,
  `Right-click a workspace to give it separate logins.`,
  `Press <kbd>${mod}E</kbd> for a notepad that remembers everything.`,
  `Type <kbd>23*19</kbd> in the command bar. It does math.`,
  `Press <kbd>${mod}Shift+T</kbd> to bring back a tab you closed.`,
];

function greeting(name) {
  const h = new Date().getHours();
  const part = h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  return name ? `${part}, ${name}` : part;
}

function siteTile(site) {
  const host = hostOf(site.url);
  const avatar = el('span', { class: 'avatar' }, host.charAt(0).toUpperCase());
  if (site.favicon) {
    const img = el('img', { src: site.favicon, alt: '', referrerpolicy: 'no-referrer' });
    img.onload = () => {
      avatar.textContent = '';
      avatar.append(img);
    };
  }
  const remove = el('button', {
    class: 'remove',
    title: 'Remove from history',
    html: icon('x', 12),
    onclick: async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await api.call('removeTopSite', site.url);
      render();
    },
  });
  return el('a', { class: 'site', href: site.url, title: `${site.title}\n${site.url}` }, avatar, el('span', { class: 'name' }, site.title || host), remove);
}

async function render() {
  const data = await api.call('getNewTabData');
  applyTheme(data);
  if (!data.isPrivate) applyAccent(data.accent);
  document.body.classList.toggle('is-private', data.isPrivate);
  document.getElementById('greeting').textContent = data.isPrivate ? 'You’re browsing privately' : greeting(data.settings.greetingName);
  document.getElementById('date').textContent = data.isPrivate
    ? 'Nothing from this window (history, cookies, site data) is saved after you close it. Downloads and bookmarks are kept.'
    : new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const engines = { duckduckgo: 'DuckDuckGo', google: 'Google', brave: 'Brave Search', bing: 'Bing', ecosia: 'Ecosia', startpage: 'Startpage' };
  document.getElementById('search').placeholder = `Search with ${engines[data.settings.searchEngine] || 'the web'} or type an address`;

  const sites = document.getElementById('sites');
  sites.textContent = '';
  for (const s of data.topSites) sites.append(siteTile(s));

  const stats = document.getElementById('stats');
  stats.textContent = '';
  if (data.settings.showBlockedStats && data.settings.adblock && !data.isPrivate) {
    stats.innerHTML = `${icon('shield-check', 16)}<span><b>${data.blocked.toLocaleString()}</b> ads &amp; trackers blocked so far</span>`;
  }
}

document.getElementById('search-icon').innerHTML = icon('search', 20);
document.getElementById('kbd-hint').textContent = `${mod}K`;
document.getElementById('tips').innerHTML = TIPS[Math.floor(Math.random() * TIPS.length)];

fetch('lions://assets/logo.svg')
  .then((r) => r.text())
  .then((svg) => {
    const logo = document.getElementById('logo');
    logo.innerHTML = svg;
    logo.onclick = () => {
      logo.classList.add('wiggle');
      setTimeout(() => logo.classList.remove('wiggle'), 600);
    };
  });

document.getElementById('search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = document.getElementById('search').value.trim();
  if (q) api.call('navigate', q);
});

api.on((name) => {
  if (name === 'settings-changed' || name === 'theme-changed') render();
});
render();
document.getElementById('search').focus();
