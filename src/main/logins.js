'use strict';

const { ipcMain, safeStorage } = require('electron');
const { ctx } = require('./context');
const { originOf } = require('./passwords');

const codec = {
  encrypt: (text) => available() && safeStorage.encryptString(text).toString('base64'),
  decrypt: (data) => available() && safeStorage.decryptString(Buffer.from(data, 'base64')),
};

let fallbackChecked = false;

function available() {
  if (!fallbackChecked && process.platform === 'linux' && !safeStorage.isEncryptionAvailable()) {
    fallbackChecked = true;
    safeStorage.setUsePlainTextEncryption?.(true);
  }
  return safeStorage.isEncryptionAvailable();
}

function weakStorage() {
  return process.platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text';
}

function tabFor(wc) {
  for (const w of ctx.windows) for (const t of w.allTabs()) if (t.wc === wc) return { w, t };
  return {};
}

function frameOrigin(event) {
  const frame = event.senderFrame;
  if (!frame || frame.parent) return null;
  return originOf(frame.url);
}

function onSubmitted(event, data) {
  const origin = frameOrigin(event);
  const { w, t } = tabFor(event.sender);
  if (!origin || !w || w.isPrivate || !available()) return;
  if (!ctx.settings().offerToSavePasswords || ctx.passwords.isNever(origin)) return;
  const username = String(data?.username || '').slice(0, 500);
  const password = String(data?.password || '').slice(0, 1000);
  if (!password) return;
  const state = ctx.passwords.check(origin, username, password);
  if (state === 'same') {
    ctx.passwords.markUsed(ctx.passwords.find(origin, username).id);
    return;
  }
  t.pendingLogin = { origin, username, password, update: state === 'update' };
  if (w.activeTab() === t) w.showPasswordBubble();
  else w.scheduleState();
}

function onForm(event) {
  const { w, t } = tabFor(event.sender);
  if (!t || !frameOrigin(event)) return;
  t.hasLoginForm = true;
  w.scheduleState();
}

function autofill(event) {
  const origin = frameOrigin(event);
  if (!origin || !ctx.settings().autofillPasswords || !available()) return null;
  const logins = ctx.passwords.forOrigin(origin);
  if (logins.length !== 1) return null;
  ctx.passwords.markUsed(logins[0].id);
  const { username, password } = ctx.passwords.credentials(logins[0].id);
  return { username, password };
}

function originOfTab(tab) {
  return tab?.wc ? originOf(tab.wc.getURL()) : null;
}

function savedFor(tab) {
  const origin = originOfTab(tab);
  return origin && available() ? ctx.passwords.forOrigin(origin) : [];
}

function fill(tab, id) {
  const login = ctx.passwords.credentials(id);
  if (!login || !tab?.wc || originOfTab(tab) !== login.origin) return;
  ctx.passwords.markUsed(id);
  tab.wc.send('lions:password-fill', login);
}

function save(tab, username) {
  const pending = tab?.pendingLogin;
  if (!pending) return;
  const name = typeof username === 'string' ? username.trim().slice(0, 500) : pending.username;
  ctx.passwords.save(pending.origin, name, pending.password);
  tab.pendingLogin = null;
  require('./internal-api').broadcast('passwords-changed');
}

function never(tab) {
  if (!tab?.pendingLogin) return;
  ctx.passwords.addNever(tab.pendingLogin.origin);
  tab.pendingLogin = null;
  require('./internal-api').broadcast('passwords-changed');
}

function init() {
  ipcMain.on('lions:password-submitted', onSubmitted);
  ipcMain.on('lions:password-form', onForm);
  ipcMain.handle('lions:password-autofill', autofill);
}

module.exports = { init, codec, available, weakStorage, savedFor, fill, save, never, originOfTab };
