'use strict';

window.lions?.call('getSettings').then((s) => {
  document.documentElement.classList.toggle('dark', Boolean(s.dark));
  document.documentElement.classList.toggle('private', Boolean(s.isPrivate));
});

const q = new URLSearchParams(location.search);
const code = q.get('code') || '';
const desc = q.get('desc') || '';
const url = q.get('url') || '';

let host = url;
try {
  host = new URL(url).host;
} catch {
}

const n = Number(code);
let title = 'This page isn’t working';
let text = 'Something went wrong while loading this page.';
let glyph = 'globe';

if (code === 'crash') {
  title = 'This page crashed';
  text = 'Something went wrong while displaying this page. Reloading usually fixes it.';
  glyph = 'triangle-alert';
} else if (n === -105 || n === -137) {
  title = 'This site can’t be reached';
  text = `Check if there is a typo in ${host}.`;
} else if (n === -106) {
  title = 'No internet connection';
  text = 'Check your network connection and try again.';
} else if (n === -102) {
  title = 'This site can’t be reached';
  text = `${host} refused to connect.`;
} else if (n === -118 || n === -7) {
  title = 'This site can’t be reached';
  text = `${host} took too long to respond.`;
} else if (n === -21) {
  title = 'Your connection was interrupted';
  text = 'A network change was detected.';
} else if (n <= -200 && n > -300) {
  title = 'Your connection isn’t private';
  text = `LionsBrows stopped loading ${host} because its security certificate isn’t valid. Someone could be trying to intercept your information.`;
  glyph = 'lock';
} else if (n === -20) {
  title = 'This page has been blocked';
  text = 'A setting or extension blocked this page.';
  glyph = 'shield';
} else if (n === -300) {
  title = 'Invalid address';
  text = 'Check the address and try again.';
}

document.getElementById('icon').innerHTML = icon(glyph, 48);
document.title = title;
document.getElementById('title').textContent = title;
document.getElementById('desc').textContent = text;
document.getElementById('url').textContent = url;
document.getElementById('code').textContent = code === 'crash' ? desc : desc || (code ? `Error ${code}` : '');
document.getElementById('retry').onclick = () => {
  if (url) location.href = url;
};
document.getElementById('back').onclick = () => history.back();
