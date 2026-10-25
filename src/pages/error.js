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
  /* keep the raw text */
}

const n = Number(code);
let title = 'This page couldn’t load';
let text = 'Something went wrong while loading this page.';

if (code === 'crash') {
  title = 'This tab crashed';
  text = 'The page stopped working. Reloading usually fixes it.';
} else if (n === -105 || n === -137) {
  title = 'Hmm. LionsBrows can’t find that site';
  text = `We couldn’t find the server for ${host}. Check the address for typos.`;
} else if (n === -106) {
  title = 'You’re offline';
  text = 'Check your Wi-Fi or network cable, then try again.';
} else if (n === -102) {
  title = 'The site refused to connect';
  text = `${host} isn’t accepting connections right now.`;
} else if (n === -118 || n === -7) {
  title = 'The site took too long to respond';
  text = `${host} might be busy or down.`;
} else if (n === -21) {
  title = 'Your network changed';
  text = 'The connection was interrupted by a network change.';
} else if (n <= -200 && n > -300) {
  title = 'Your connection isn’t private';
  text = `The security certificate for ${host} isn’t valid, so LionsBrows stopped loading it. Attackers might be trying to steal your information.`;
} else if (n === -20) {
  title = 'This page was blocked';
  text = 'An extension or setting blocked this page.';
} else if (n === -300) {
  title = 'That address isn’t valid';
  text = 'Check the address and try again.';
}

document.title = title;
document.getElementById('title').textContent = title;
document.getElementById('desc').textContent = text;
document.getElementById('url').textContent = url;
document.getElementById('code').textContent = code === 'crash' ? desc : desc || (code ? `Error ${code}` : '');
document.getElementById('retry').onclick = () => {
  if (url) location.href = url;
};
document.getElementById('back').onclick = () => history.back();
