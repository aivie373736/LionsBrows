'use strict';

const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'lions:') {
  contextBridge.exposeInMainWorld('lions', {
    call: (method, ...args) => ipcRenderer.invoke('lions:call', method, ...args),
    on: (callback) => ipcRenderer.on('lions:event', (_event, name, data) => callback(name, data)),
  });
} else if (location.protocol === 'https:' || location.protocol === 'http:') {
  const TEXT_TYPES = new Set(['text', 'email', 'tel', 'number', '']);
  const USERNAME_HINT = /user|e-?mail|login|account|ident|phone/i;
  let lastSent = '';
  let offered = false;
  let scanTimer = null;

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };

  function inputs(deep) {
    if (!deep) return [...document.querySelectorAll('input')];
    const out = [];
    const walk = (root) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      for (let node = walker.currentNode; node; node = walker.nextNode()) {
        if (node.localName === 'input') out.push(node);
        if (node.shadowRoot) walk(node.shadowRoot);
      }
    };
    walk(document.documentElement);
    return out;
  }

  const isPassword = (i) => i.type === 'password' && !i.disabled && visible(i);
  const isText = (i) => TEXT_TYPES.has(i.type) && !i.disabled;
  const usernameScore = (i) => (/username|email/i.test(i.autocomplete) ? 3 : 0) + (i.type === 'email' ? 2 : 0) + (USERNAME_HINT.test(`${i.name} ${i.id}`) ? 1 : 0);

  function usernameFor(pw, list) {
    const before = list.slice(0, list.indexOf(pw)).filter(isText);
    const shown = before.filter(visible);
    const best = (items) => items.reduce((a, b) => (usernameScore(b) > usernameScore(a) ? b : a), items.at(-1));
    if (shown.length) return shown.some((i) => usernameScore(i) > 0) ? best(shown.slice(-3)) : shown.at(-1);
    return before.find((i) => i.value && usernameScore(i) > 0) || null;
  }

  function loginFields(deep) {
    const list = inputs(deep);
    const pw = list.find((i) => isPassword(i) && i.autocomplete !== 'new-password') || list.find(isPassword);
    return pw ? { pw, user: usernameFor(pw, list) } : null;
  }

  function setValue(input, value) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function capture() {
    const list = inputs(true);
    const pw = list.find((i) => isPassword(i) && i.value);
    if (!pw) {
      const user = list.filter((i) => isText(i) && visible(i) && i.value && usernameScore(i) > 0).at(-1);
      if (user) ipcRenderer.send('lions:username-submitted', { username: user.value.trim() });
      return;
    }
    const user = usernameFor(pw, list);
    const username = user ? user.value.trim() : '';
    const key = `${username}\n${pw.value}`;
    if (key === lastSent) return;
    lastSent = key;
    ipcRenderer.send('lions:password-submitted', { username, password: pw.value });
  }

  function fill({ username, password }) {
    const fields = loginFields(true);
    if (fields) {
      if (fields.user && username) setValue(fields.user, username);
      setValue(fields.pw, password);
      return true;
    }
    const user = inputs(true).filter((i) => isText(i) && visible(i) && usernameScore(i) > 0).at(-1);
    if (user && username) setValue(user, username);
    return Boolean(user);
  }

  async function offer(deep = false) {
    if (offered) return;
    const fields = loginFields(deep);
    if (!fields) return;
    offered = true;
    observer.disconnect();
    ipcRenderer.send('lions:password-form');
    const login = await ipcRenderer.invoke('lions:password-autofill');
    if (!login) return;
    if (fields.user && !fields.user.value && login.username) setValue(fields.user, login.username);
    if (!fields.pw.value) setValue(fields.pw, login.password);
  }

  async function offerUsername() {
    if (offered) return;
    const user = inputs(true).filter((i) => isText(i) && visible(i) && !i.value && usernameScore(i) >= 2).at(-1);
    if (!user) return;
    const login = await ipcRenderer.invoke('lions:password-autofill', { usernameOnly: true });
    if (login && !user.value && !offered) setValue(user, login.username);
  }

  function scheduleScan() {
    if (offered || scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      offer();
    }, 400);
  }

  const observer = new MutationObserver(scheduleScan);
  const targetOf = (e) => e.composedPath()[0];

  document.addEventListener('submit', capture, true);
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Enter' && targetOf(e) instanceof HTMLInputElement) capture();
    },
    true,
  );
  document.addEventListener(
    'click',
    (e) => {
      const target = targetOf(e);
      if (target instanceof Element && target.closest('button, input[type="submit"], input[type="button"], [role="button"]')) capture();
    },
    true,
  );
  document.addEventListener('focusin', (e) => {
    const target = targetOf(e);
    if (target instanceof HTMLInputElement && (target.type === 'password' || target.getRootNode() !== document)) offer(true);
  });
  document.addEventListener('DOMContentLoaded', () => {
    offer();
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => {
      offer(true).then(() => offerUsername());
    }, 1500);
    setTimeout(() => observer.disconnect(), 20000);
  });

  ipcRenderer.on('lions:password-fill', (_event, login) => {
    if (login && login.origin === location.origin) fill(login);
  });
}
