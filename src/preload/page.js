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
    if (isNewPassword(fields.pw)) return;
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

  const NEW_HINT = /new|confirm|repeat|again|register|sign-?up|create|neu|wiederhol|bestätig/i;
  const KEY_ICON =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/></svg>';
  let suggestion = null;

  function deepActive() {
    let active = document.activeElement;
    while (active && active.shadowRoot && active.shadowRoot.activeElement) active = active.shadowRoot.activeElement;
    return active;
  }

  function passwordFields(input) {
    const root = input.form || input.getRootNode();
    return [...root.querySelectorAll('input[type="password"]')].filter((i) => visible(i) && !i.disabled && !i.readOnly && i.autocomplete !== 'current-password');
  }

  function isNewPassword(input) {
    if (input.autocomplete === 'new-password') return true;
    if (input.autocomplete === 'current-password') return false;
    return passwordFields(input).length >= 2 || NEW_HINT.test(`${input.name} ${input.id} ${input.placeholder} ${input.getAttribute('aria-label') || ''}`);
  }

  function generatePassword(maxLength) {
    const sets = ['abcdefghijkmnopqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789', '-_!?'];
    const all = sets.join('');
    const random = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
    const length = Math.max(8, Math.min(16, maxLength > 0 ? maxLength : 16));
    const chars = sets.map((set) => set[random(set.length)]);
    while (chars.length < length) chars.push(all[random(all.length)]);
    for (let i = chars.length - 1; i > 0; i--) {
      const j = random(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
  }

  function hideSuggestion() {
    if (!suggestion) return;
    suggestion.host.remove();
    window.removeEventListener('scroll', suggestion.place, true);
    window.removeEventListener('resize', suggestion.place);
    suggestion = null;
  }

  async function suggest(input) {
    if (suggestion && suggestion.input === input) return;
    hideSuggestion();
    if (input.value || !isNewPassword(input)) return;
    const info = await ipcRenderer.invoke('lions:password-suggest');
    if (!info || deepActive() !== input || input.value || suggestion) return;
    const password = generatePassword(input.maxLength);
    const host = document.createElement('lionsbrows-suggestion');
    const root = host.attachShadow({ mode: 'closed' });
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const accent = /^#[0-9a-f]{6}$/i.test(info.accent) ? info.accent : '#7542e5';
    root.innerHTML = `<style>
      :host { all: initial; }
      button { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 10px; width: 300px; max-width: calc(100vw - 16px); padding: 10px 14px; border-radius: 12px; cursor: pointer;
        font: 13px/1.35 "Segoe UI", system-ui, -apple-system, sans-serif; background: ${dark ? '#26252c' : '#ffffff'}; color: ${dark ? '#f4f3f8' : '#15141a'};
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18), 0 0 0 1px ${dark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)'}; animation: pop 0.12s ease-out; }
      button:hover, button:focus-visible { background: ${dark ? '#302f37' : '#f4f3f8'}; }
      .k { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 8px; flex: none; color: ${accent}; background: color-mix(in srgb, ${accent} 15%, transparent); }
      .t { display: grid; gap: 2px; min-width: 0; }
      b { font-weight: 600; }
      code { font: 12.5px ui-monospace, "Cascadia Mono", Consolas, monospace; opacity: 0.75; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      small { font-size: 11.5px; opacity: 0.6; }
      @keyframes pop { from { opacity: 0; transform: translateY(-3px); } }
    </style><button type="button"><span class="k">${KEY_ICON}</span><span class="t"><b></b><code></code><small></small></span></button>`;
    root.querySelector('b').textContent = info.title;
    root.querySelector('code').textContent = password;
    root.querySelector('small').textContent = info.hint;
    const button = root.querySelector('button');
    button.addEventListener('mousedown', (e) => e.preventDefault());
    button.addEventListener('click', (e) => {
      if (!e.isTrusted) return;
      for (const field of passwordFields(input)) setValue(field, password);
      ipcRenderer.send('lions:password-generated', { password });
      hideSuggestion();
    });
    const place = () => {
      const r = input.getBoundingClientRect();
      if (!r.width) return hideSuggestion();
      host.style.setProperty('position', 'fixed', 'important');
      host.style.setProperty('z-index', '2147483647', 'important');
      host.style.setProperty('top', `${Math.round(r.bottom + 6)}px`, 'important');
      host.style.setProperty('left', `${Math.round(Math.max(8, Math.min(r.left, innerWidth - 308)))}px`, 'important');
    };
    suggestion = { host, input, place };
    place();
    document.documentElement.append(host);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
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
    if (target instanceof HTMLInputElement && target.type === 'password') suggest(target);
  });
  document.addEventListener('focusout', (e) => {
    if (suggestion && targetOf(e) === suggestion.input) setTimeout(() => deepActive() !== suggestion?.input && hideSuggestion(), 100);
  });
  document.addEventListener(
    'input',
    (e) => {
      if (suggestion && e.isTrusted && targetOf(e) === suggestion.input) hideSuggestion();
    },
    true,
  );
  document.addEventListener(
    'keydown',
    (e) => {
      if (suggestion && e.key === 'Escape') hideSuggestion();
    },
    true,
  );
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
