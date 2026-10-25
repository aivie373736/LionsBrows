'use strict';

const crypto = require('node:crypto');
const { ctx } = require('./context');

const ICONS = ['🦁', '💼', '🎮', '📚', '🎵', '🛒', '🎬', '🧪', '✈️', '🏠', '💡', '🔥', '🌿', '🐾', '⚽', '🎨'];

function changed() {
  ctx.events.emit('workspaces-changed');
}

function create(name, icon) {
  const used = new Set(ctx.workspaces().map((w) => w.icon));
  const ws = {
    id: crypto.randomUUID().slice(0, 8),
    name: (name || '').trim().slice(0, 40) || `Workspace ${ctx.workspaces().length + 1}`,
    icon: icon || ICONS.find((i) => !used.has(i)) || '🦁',
    isolated: false,
  };
  ctx.config.update((d) => d.workspaces.push(ws));
  changed();
  return ws;
}

function patch(id, fn) {
  ctx.config.update((d) => {
    const ws = d.workspaces.find((w) => w.id === id);
    if (ws) fn(ws);
  });
  changed();
}

function rename(id, name) {
  if (name && name.trim()) patch(id, (ws) => (ws.name = name.trim().slice(0, 40)));
}

function setIcon(id, icon) {
  patch(id, (ws) => (ws.icon = icon));
}

function setIsolated(id, isolated) {
  patch(id, (ws) => (ws.isolated = Boolean(isolated)));
  // Tabs keep running in their old session until they reload; put them to
  // sleep so they wake up in the right cookie jar.
  for (const w of ctx.windows) for (const t of w.allTabs()) if (t.workspaceId === id && !w.visibleTabs().includes(t)) t.sleep();
  for (const w of ctx.windows) for (const t of w.visibleTabs()) if (t.workspaceId === id) w.rebuildTab(t);
}

function remove(id) {
  const list = ctx.workspaces();
  if (list.length <= 1) return false;
  const fallback = list.find((w) => w.id !== id).id;
  for (const w of ctx.windows) {
    if (w.isPrivate) continue;
    for (const t of w.allTabs()) if (t.workspaceId === id) w.moveTabToWorkspace(t.id, fallback);
    if (w.activeWorkspaceId === id) w.switchWorkspace(fallback);
    w.spaces.delete(id);
  }
  ctx.config.update((d) => (d.workspaces = d.workspaces.filter((w) => w.id !== id)));
  changed();
  return true;
}

module.exports = { ICONS, create, rename, setIcon, setIsolated, remove };
