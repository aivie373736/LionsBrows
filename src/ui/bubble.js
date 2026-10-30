'use strict';

const $ = (sel) => document.querySelector(sel);
const send = (name, ...args) => window.lions.bubble(name, ...args);
const card = $('#card');
const site = $('#site');
const qr = $('#qr');
const cards = [card, site, qr];
const username = $('#username');
const password = $('#password');
const PERMISSIONS = [
  ['camera', 'Camera', 'camera'],
  ['microphone', 'Microphone', 'mic'],
  ['location', 'Location', 'map-pin'],
  ['notifications', 'Notifications', 'bell'],
];

let update = false;

function onAccent(hex) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255) > 150 ? '#15141a' : '#ffffff';
}

function visibleCard() {
  return cards.find((c) => !c.hidden) || card;
}

function reportSize() {
  requestAnimationFrame(() => send('size', visibleCard().getBoundingClientRect().height + 30));
}

function setRevealed(on) {
  password.type = on ? 'text' : 'password';
  $('#reveal').innerHTML = icon(on ? 'eye-off' : 'eye', 16);
  $('#reveal').title = on ? tr('Hide password') : tr('Show password');
}

function cookieText(n) {
  if (n === 0) return tr('No cookies');
  return n === 1 ? tr('1 cookie') : tr('{n} cookies', { n: n.toLocaleString(LOCALE) });
}

function renderPermissions(state) {
  $('#site-perms').replaceChildren(
    ...PERMISSIONS.map(([kind, label, iconName]) => {
      const seg = document.createElement('div');
      seg.className = 'seg';
      for (const [value, text] of [
        ['ask', 'Ask'],
        ['allow', 'Allow'],
        ['block', 'Block'],
      ]) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.value = value;
        b.textContent = tr(text);
        b.classList.toggle('on', state[kind] === value);
        b.setAttribute('aria-pressed', String(state[kind] === value));
        b.onclick = async () => {
          if (state[kind] === value) return;
          renderPermissions(await send('sitePermission', kind, value));
          $('#site-reload').hidden = false;
          reportSize();
        };
        seg.append(b);
      }
      const row = document.createElement('div');
      row.className = 'site-row';
      const ico = document.createElement('span');
      ico.className = 'row-icon';
      ico.innerHTML = icon(iconName, 16);
      const text = document.createElement('div');
      text.className = 'row-text';
      text.textContent = tr(label);
      row.append(ico, text, seg);
      return row;
    }),
  );
}

$('#lead').innerHTML = icon('key-round', 16);
$('#close').innerHTML = icon('x', 16);
$('#close').onclick = () => send('close');
$('#reveal').onclick = () => setRevealed(password.type === 'password');
$('#primary').onclick = () => send('passwordSave', username.value);
$('#secondary').onclick = () => send(update ? 'passwordDismiss' : 'passwordNever');
username.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') send('passwordSave', username.value);
});

$('#site-close').innerHTML = icon('x', 16);
$('#site-close').onclick = () => send('close');
$('#site-cookie-icon').innerHTML = icon('cookie', 16);
$('#site-settings').onclick = () => send('siteSettings');
$('#site-reload').onclick = () => send('siteReload');
$('#site-clear').onclick = async () => {
  $('#site-clear').disabled = true;
  await send('siteClear');
  $('#site-cookies').textContent = tr('Deleted. You may need to sign in again.');
  reportSize();
};

function showPassword(opts) {
  update = Boolean(opts.update);
  $('#title').textContent = update ? tr('Update password for {host}?', { host: opts.host }) : tr('Save password for {host}?', { host: opts.host });
  $('#title').title = $('#title').textContent;
  username.value = opts.username || '';
  password.value = opts.password || '';
  setRevealed(false);
  $('#primary').textContent = update ? tr('Update') : tr('Save');
  $('#secondary').textContent = update ? tr('Not now') : tr('Never for this site');
  return card;
}

$('#qr-lead').innerHTML = icon('qr-code', 16);
$('#qr-close').innerHTML = icon('x', 16);
$('#qr-close').onclick = () => send('close');
$('#qr-copy').onclick = async () => {
  await send('qrCopy');
  $('#qr-copy').textContent = tr('Copied');
};

function showQr(opts) {
  const box = $('#qr-code');
  box.classList.toggle('empty', !opts.svg);
  if (opts.svg) box.innerHTML = opts.svg;
  else box.textContent = tr('This link is too long for a QR code.');
  $('#qr-url').textContent = opts.url;
  $('#qr-copy').textContent = tr('Copy link');
  return qr;
}

function showSite(opts) {
  $('#site-title').textContent = opts.host;
  $('#site-title').title = opts.host;
  $('#site-lead').innerHTML = icon(opts.secure ? 'lock' : 'lock-open', 16);
  $('#site-lead').classList.toggle('warn', !opts.secure);
  $('.status').classList.toggle('warn', !opts.secure);
  $('#site-status').textContent = opts.secure ? tr('Connection is secure') : tr('Connection is not secure');
  $('#site-status-sub').textContent = opts.secure ? tr('Information you send to this site stays private.') : tr('Don’t enter passwords or payment details on this site.');
  $('#site-cookies').textContent = cookieText(opts.cookies);
  $('#site-clear').disabled = opts.cookies === 0;
  $('#site-reload').hidden = true;
  renderPermissions(opts.permissions);
  return site;
}

window.lions.on('bubble:show', (opts) => {
  const root = document.documentElement;
  root.classList.toggle('dark', Boolean(opts.dark));
  root.classList.toggle('private', Boolean(opts.isPrivate));
  if (!opts.isPrivate && opts.accent) {
    root.style.setProperty('--accent-base', opts.accent);
    root.style.setProperty('--on-accent-base', onAccent(opts.accent));
  }
  const shown = opts.kind === 'site' ? showSite(opts) : opts.kind === 'qr' ? showQr(opts) : showPassword(opts);
  for (const c of cards) c.hidden = c !== shown;
  shown.style.animation = 'none';
  void shown.offsetWidth;
  shown.style.animation = '';
  reportSize();
  if (shown === card) $('#primary').focus();
  else shown.querySelector('.icon-btn').focus();
});
