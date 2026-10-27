'use strict';

const $ = (sel) => document.querySelector(sel);
const send = (name, ...args) => window.lions.bubble(name, ...args);
const card = $('#card');
const username = $('#username');
const password = $('#password');

let update = false;

function onAccent(hex) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255) > 150 ? '#15141a' : '#ffffff';
}

function reportSize() {
  requestAnimationFrame(() => send('size', card.getBoundingClientRect().height + 30));
}

function setRevealed(on) {
  password.type = on ? 'text' : 'password';
  $('#reveal').innerHTML = icon(on ? 'eye-off' : 'eye', 16);
  $('#reveal').title = on ? tr('Hide password') : tr('Show password');
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

window.lions.on('bubble:show', (opts) => {
  const root = document.documentElement;
  root.classList.toggle('dark', Boolean(opts.dark));
  root.classList.toggle('private', Boolean(opts.isPrivate));
  if (!opts.isPrivate && opts.accent) {
    root.style.setProperty('--accent-base', opts.accent);
    root.style.setProperty('--on-accent-base', onAccent(opts.accent));
  }
  update = Boolean(opts.update);
  $('#title').textContent = update ? tr('Update password for {host}?', { host: opts.host }) : tr('Save password for {host}?', { host: opts.host });
  $('#title').title = $('#title').textContent;
  username.value = opts.username || '';
  password.value = opts.password || '';
  setRevealed(false);
  $('#primary').textContent = update ? tr('Update') : tr('Save');
  $('#secondary').textContent = update ? tr('Not now') : tr('Never for this site');
  card.hidden = false;
  card.style.animation = 'none';
  void card.offsetWidth;
  card.style.animation = '';
  reportSize();
  $('#primary').focus();
});
