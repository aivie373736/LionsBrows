'use strict';

const { dialog, desktopCapturer, BaseWindow } = require('electron');
const { ctx } = require('./context');
const { tr } = require('./i18n');

const ALWAYS_ALLOW = new Set([
  'fullscreen',
  'clipboard-sanitized-write',
  'pointerLock',
  'keyboardLock',
  'speaker-selection',
  'storage-access',
  'top-level-storage-access',
]);

const DESCRIPTIONS = {
  geolocation: 'know your location',
  notifications: 'show notifications',
  'clipboard-read': 'see text and images you copy',
  midi: 'use your MIDI devices',
  midiSysex: 'get full control of your MIDI devices',
  'idle-detection': 'know when you are actively using this device',
  'window-management': 'manage windows on all your displays',
  'display-capture': 'see your screen',
  mediaKeySystem: 'play protected content',
  fileSystem: 'edit files on your device',
};

const memory = new Map();
const pending = new Map();

function describe(permission, details) {
  if (permission === 'media') {
    const types = details.mediaTypes || [];
    if (types.includes('video') && types.includes('audio')) return tr('use your camera and microphone');
    if (types.includes('video')) return tr('use your camera');
    return tr('use your microphone');
  }
  return DESCRIPTIONS[permission] ? tr(DESCRIPTIONS[permission]) : tr('use “{name}”', { name: permission });
}

function keyFor(permission, details) {
  return permission === 'media' ? `media:${[...(details.mediaTypes || [])].sort().join('+')}` : permission;
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

function lookup(isPrivate, origin, key) {
  if (isPrivate) return memory.get(`${origin}|${key}`);
  return ctx.config.get('permissions')[origin]?.[key];
}

function remember(isPrivate, origin, key, decision) {
  if (isPrivate) return memory.set(`${origin}|${key}`, decision);
  ctx.config.update((d) => {
    d.permissions[origin] = { ...(d.permissions[origin] || {}), [key]: decision };
  });
}

function windowFor(wc) {
  for (const w of ctx.windows) if (w.ownsWebContents(wc)) return w.win;
  return BaseWindow.getFocusedWindow() || undefined;
}

async function prompt(wc, origin, text) {
  const host = origin.replace(/^https?:\/\//, '');
  const { response, checkboxChecked } = await dialog.showMessageBox(windowFor(wc), {
    type: 'question',
    buttons: [tr('Allow'), tr('Block')],
    defaultId: 1,
    cancelId: 1,
    title: tr('Permission request'),
    message: tr('{host} wants to {action}', { host, action: text }),
    checkboxLabel: tr('Remember my decision for this site'),
    checkboxChecked: true,
  });
  return { allow: response === 0, remember: checkboxChecked };
}

function attach(ses, { isPrivate }) {
  ses.setPermissionRequestHandler(async (wc, permission, callback, details) => {
    if (ALWAYS_ALLOW.has(permission)) return callback(true);
    const origin = originOf(details.requestingUrl || wc.getURL());
    if (!origin || origin.startsWith('lions:')) return callback(origin.startsWith('lions:'));
    if (!(permission in DESCRIPTIONS) && permission !== 'media') return callback(false);

    const key = keyFor(permission, details);
    const stored = lookup(isPrivate, origin, key);
    if (stored) return callback(stored === 'allow');

    const id = `${origin}|${key}`;
    if (!pending.has(id)) pending.set(id, prompt(wc, origin, describe(permission, details)).finally(() => pending.delete(id)));
    try {
      const answer = await pending.get(id);
      if (answer.remember) remember(isPrivate, origin, key, answer.allow ? 'allow' : 'deny');
      callback(answer.allow);
    } catch {
      callback(false);
    }
  });

  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    if (ALWAYS_ALLOW.has(permission)) return true;
    const origin = originOf(requestingOrigin);
    if (origin.startsWith('lions:')) return true;
    const perms = isPrivate ? null : ctx.config.get('permissions')[origin];
    const decisions = perms ? Object.entries(perms).filter(([k]) => k === permission || k.startsWith(`${permission}:`)) : [];
    if (decisions.some(([, v]) => v === 'deny')) return false;
    if (decisions.some(([, v]) => v === 'allow')) return true;
    return permission !== 'notifications';
  });

  ses.setDisplayMediaRequestHandler(
    async (request, callback) => {
      const origin = originOf(request.securityOrigin || request.frame?.url || '');
      try {
        const answer = await prompt(request.frame, origin || tr('This site'), tr('share your entire screen'));
        if (!answer.allow) return callback({});
        const [screen] = await desktopCapturer.getSources({ types: ['screen'] });
        callback(screen ? { video: screen } : {});
      } catch {
        callback({});
      }
    },
    { useSystemPicker: true },
  );
}

function list() {
  return ctx.config.get('permissions');
}

function reset(origin) {
  ctx.config.update((d) => {
    if (origin) delete d.permissions[origin];
    else d.permissions = {};
  });
}

module.exports = { attach, list, reset };
