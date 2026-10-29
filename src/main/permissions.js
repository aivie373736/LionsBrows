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
  'mediaKeySystem',
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

const DEFAULT_SETTING = { geolocation: 'defaultLocation', notifications: 'defaultNotifications' };

function blockedByDefault(permission, mediaTypes = []) {
  const s = ctx.settings();
  if (permission === 'media') {
    return (mediaTypes.includes('video') && s.defaultCamera === 'block') || (mediaTypes.includes('audio') && s.defaultMicrophone === 'block');
  }
  return DEFAULT_SETTING[permission] ? s[DEFAULT_SETTING[permission]] === 'block' : false;
}

const SITE_KINDS = { camera: 'media:video', microphone: 'media:audio', location: 'geolocation', notifications: 'notifications' };

function keysFor(permission, details) {
  if (permission !== 'media') return [permission];
  const types = (details.mediaTypes || []).filter((t) => t === 'audio' || t === 'video');
  return (types.length ? types : ['audio']).map((t) => `media:${t}`);
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
  const perms = ctx.config.get('permissions')[origin];
  return perms?.[key] ?? (key.startsWith('media:') ? perms?.['media:audio+video'] : undefined);
}

function forget(isPrivate, origin, key) {
  if (isPrivate) return memory.delete(`${origin}|${key}`);
  ctx.config.update((d) => {
    const perms = d.permissions[origin];
    if (!perms) return;
    const legacy = perms['media:audio+video'];
    if (legacy && key.startsWith('media:')) {
      delete perms['media:audio+video'];
      perms['media:audio'] ??= legacy;
      perms['media:video'] ??= legacy;
    }
    delete perms[key];
    if (!Object.keys(perms).length) delete d.permissions[origin];
  });
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

    const keys = keysFor(permission, details);
    const stored = keys.map((key) => lookup(isPrivate, origin, key));
    if (stored.includes('deny')) return callback(false);
    if (stored.every((v) => v === 'allow')) return callback(true);
    if (blockedByDefault(permission, details.mediaTypes)) return callback(false);

    const id = `${origin}|${keys.join('+')}`;
    if (!pending.has(id)) pending.set(id, prompt(wc, origin, describe(permission, details)).finally(() => pending.delete(id)));
    try {
      const answer = await pending.get(id);
      if (answer.remember) for (const key of keys) remember(isPrivate, origin, key, answer.allow ? 'allow' : 'deny');
      callback(answer.allow);
    } catch {
      callback(false);
    }
  });

  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin, details = {}) => {
    if (ALWAYS_ALLOW.has(permission)) return true;
    const origin = originOf(requestingOrigin);
    if (origin.startsWith('lions:')) return true;
    if (permission === 'media' && (details.mediaType === 'audio' || details.mediaType === 'video')) {
      const stored = lookup(isPrivate, origin, `media:${details.mediaType}`);
      if (stored) return stored === 'allow';
    } else {
      const perms = isPrivate ? null : ctx.config.get('permissions')[origin];
      const decisions = perms ? Object.entries(perms).filter(([k]) => k === permission || k.startsWith(`${permission}:`)) : [];
      if (decisions.some(([, v]) => v === 'deny')) return false;
      if (decisions.some(([, v]) => v === 'allow')) return true;
    }
    if (blockedByDefault(permission, details.mediaType ? [details.mediaType] : [])) return false;
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

function siteState(origin, isPrivate) {
  const out = {};
  for (const [kind, key] of Object.entries(SITE_KINDS)) {
    const stored = lookup(isPrivate, origin, key);
    out[kind] = stored === 'allow' ? 'allow' : stored === 'deny' ? 'block' : 'ask';
  }
  return out;
}

function setSite(origin, isPrivate, kind, value) {
  const key = SITE_KINDS[kind];
  if (!key || !['ask', 'allow', 'block'].includes(value)) return siteState(origin, isPrivate);
  if (value === 'ask') forget(isPrivate, origin, key);
  else {
    if (key.startsWith('media:') && lookup(isPrivate, origin, key) !== undefined) forget(isPrivate, origin, key);
    remember(isPrivate, origin, key, value === 'allow' ? 'allow' : 'deny');
  }
  return siteState(origin, isPrivate);
}

module.exports = { attach, list, reset, siteState, setSite, originOf };
