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

  if (location.origin === 'https://chromewebstore.google.com') {
    const values = (list) => Object.fromEntries(list.map((v) => [v.toUpperCase(), v]));
    let notify = null;
    ipcRenderer.on('lions:webstore-event', (_event, name, data) => notify && notify(name, data));
    contextBridge.executeInMainWorld({
      func: (bridge) => {
        const chrome = window.chrome || (window.chrome = {});
        const runtime = chrome.runtime || (chrome.runtime = {});
        const management = chrome.management || (chrome.management = {});
        const setError = (message) => {
          const value = message ? { message } : undefined;
          chrome.extension = chrome.extension || {};
          try {
            chrome.extension.lastError = value;
            runtime.lastError = value;
          } catch {
            return;
          }
        };
        const wrap =
          (method, pick = (v) => v, error = () => null) =>
          (...args) => {
            const callback = typeof args[args.length - 1] === 'function' ? args.pop() : null;
            return bridge.call(method, args).then((reply) => {
              setError(error(reply));
              const value = pick(reply);
              if (callback) callback(value);
              return value;
            });
          };
        const store = Object.assign({}, bridge.enums);
        for (const method of bridge.methods) store[method] = wrap(method);
        store.beginInstallWithManifest3 = wrap(
          'beginInstallWithManifest3',
          (r) => r.result,
          (r) => (r.result === 'success' ? null : r.message || r.result),
        );
        chrome.webstorePrivate = store;
        const listeners = { onInstalled: new Set(), onUninstalled: new Set() };
        for (const [name, set] of Object.entries(listeners)) {
          management[name] = { addListener: (fn) => set.add(fn), removeListener: (fn) => set.delete(fn), hasListener: (fn) => set.has(fn) };
        }
        bridge.subscribe((name, data) => listeners[name] && listeners[name].forEach((fn) => fn(data)));
        for (const method of ['getAll', 'get', 'setEnabled', 'uninstall']) management[method] = wrap(`management.${method}`);
        if (!runtime.getManifest) runtime.getManifest = () => ({});
      },
      args: [
        {
          methods: [
            'completeInstall',
            'enableAppLauncher',
            'getBrowserLogin',
            'getExtensionStatus',
            'getFullChromeVersion',
            'getIsLauncherEnabled',
            'getMV2DeprecationStatus',
            'getReferrerChain',
            'getStoreLogin',
            'getWebGLStatus',
            'install',
            'isInIncognitoMode',
            'isPendingCustodianApproval',
            'setStoreLogin',
          ],
          enums: {
            ExtensionInstallStatus: values(['blacklisted', 'blocked_by_policy', 'can_request', 'corrupted', 'custodian_approval_required', 'custodian_approval_required_for_installation', 'deprecated_manifest_version', 'disabled', 'enabled', 'force_installed', 'installable', 'request_pending', 'terminated']),
            MV2DeprecationStatus: values(['inactive', 'soft_disable', 'warning']),
            Result: values(['already_installed', 'blacklisted', 'blocked_by_policy', 'blocked_for_child_account', 'feature_disabled', 'icon_error', 'install_error', 'install_in_progress', 'invalid_icon_url', 'invalid_id', 'launch_in_progress', 'manifest_error', 'missing_dependencies', 'success', 'unknown_error', 'unsupported_extension_type', 'user_cancelled', 'user_gesture_required']),
            WebGlStatus: values(['webgl_allowed', 'webgl_blocked']),
          },
          call: (method, args) => ipcRenderer.invoke('lions:webstore', method, ...args),
          subscribe: (fn) => {
            notify = fn;
          },
        },
      ],
    });

    const BRANDED = new Map([
      ['Add to Chrome', 'Add to LionsBrows'],
      ['Remove from Chrome', 'Remove from LionsBrows'],
      ['Zu Chrome hinzufügen', 'Zu LionsBrows hinzufügen'],
      ['Aus Chrome entfernen', 'Aus LionsBrows entfernen'],
    ]);
    const rebrand = () => {
      for (const node of document.querySelectorAll('button span')) {
        const text = !node.childElementCount && BRANDED.get(node.textContent.trim());
        if (text) node.textContent = text;
      }
    };
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        rebrand();
      });
    }).observe(document, { childList: true, subtree: true, characterData: true });
  }
}
