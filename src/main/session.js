'use strict';

const { ctx } = require('./context');

let timer = null;

function snapshot() {
  return [...ctx.windows].filter((w) => !w.isPrivate && !w.forget && !w.win.isDestroyed()).map((w) => w.serialize());
}

function saveNow() {
  clearTimeout(timer);
  timer = null;
  const windows = snapshot();
  if (windows.length) ctx.sessionStore.set('windows', windows);
  ctx.sessionStore.flush();
}

function scheduleSave() {
  clearTimeout(timer);
  timer = setTimeout(saveNow, 1000);
}

function saved() {
  return ctx.sessionStore.get('windows') || [];
}

module.exports = { saveNow, scheduleSave, saved };
