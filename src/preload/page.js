'use strict';

const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'lions:') {
  contextBridge.exposeInMainWorld('lions', {
    call: (method, ...args) => ipcRenderer.invoke('lions:call', method, ...args),
    on: (callback) => ipcRenderer.on('lions:event', (_event, name, data) => callback(name, data)),
  });
} else if (location.protocol === 'https:' || location.protocol === 'http:') {
  const TEXT_TYPES = new Set(['text', 'email', 'tel', 'number', '']);
  let lastSent = '';
  let offered = false;
  let scanTimer = null;

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };

  const passwordFields = (scope = document) => [...scope.querySelectorAll('input[type="password"]')].filter(visible);

  function usernameFor(pw) {
    const scope = pw.form || document;
    const inputs = [...scope.querySelectorAll('input')].filter((i) => TEXT_TYPES.has(i.type) && !i.disabled && i.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING);
    const shown = inputs.filter(visible);
    return (
      shown.find((i) => /username|email/i.test(i.autocomplete)) ||
      shown.at(-1) ||
      inputs.find((i) => /username|email/i.test(i.autocomplete) && i.value) ||
      null
    );
  }

  function setValue(input, value) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function capture(scope) {
    const pw = passwordFields(scope).find((p) => p.value);
    if (!pw) return;
    const user = usernameFor(pw);
    const username = user ? user.value.trim() : '';
    const key = `${username}\n${pw.value}`;
    if (key === lastSent) return;
    lastSent = key;
    ipcRenderer.send('lions:password-submitted', { username, password: pw.value });
  }

  function fill({ username, password }) {
    const pw = passwordFields().find((p) => p.autocomplete !== 'new-password');
    if (!pw) return false;
    const user = usernameFor(pw);
    if (user && username) setValue(user, username);
    setValue(pw, password);
    return true;
  }

  async function offer() {
    if (offered) return;
    const pw = passwordFields().find((p) => p.autocomplete !== 'new-password');
    if (!pw) return;
    offered = true;
    observer.disconnect();
    ipcRenderer.send('lions:password-form');
    const login = await ipcRenderer.invoke('lions:password-autofill');
    if (login && !pw.value) fill(login);
  }

  function scheduleScan() {
    if (offered || scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      offer();
    }, 400);
  }

  const observer = new MutationObserver(scheduleScan);

  document.addEventListener('submit', (e) => capture(e.target), true);
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Enter' && e.target instanceof HTMLInputElement) capture(e.target.form || document);
    },
    true,
  );
  document.addEventListener(
    'click',
    (e) => {
      const button = e.target instanceof Element && e.target.closest('button, input[type="submit"], input[type="button"], [role="button"]');
      if (button) capture(button.form || button.closest('form') || document);
    },
    true,
  );
  document.addEventListener('focusin', (e) => {
    if (e.target instanceof HTMLInputElement && e.target.type === 'password') offer();
  });
  document.addEventListener('DOMContentLoaded', () => {
    offer();
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 20000);
  });

  ipcRenderer.on('lions:password-fill', (_event, login) => {
    if (login && login.origin === location.origin) fill(login);
  });
}
