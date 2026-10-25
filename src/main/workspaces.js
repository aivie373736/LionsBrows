'use strict';

const crypto = require('node:crypto');
const { ctx, WORKSPACE_COLORS, HEX } = require('./context');
const { tr } = require('./i18n');

const COLOR_NAMES = { '#7542e5': 'Purple', '#0061e0': 'Blue', '#1f8a3e': 'Green', '#e8811a': 'Orange', '#008787': 'Teal', '#d7264c': 'Red', '#5b5b66': 'Graphite', '#c50093': 'Pink' };

function changed() {
  ctx.events.emit('workspaces-changed');
}

function create(name) {
  const used = new Set(ctx.workspaces().map((w) => w.color));
  const ws = {
    id: crypto.randomUUID().slice(0, 8),
    name: (name || '').trim().slice(0, 40) || tr('Workspace {n}', { n: ctx.workspaces().length + 1 }),
    color: WORKSPACE_COLORS.find((c) => !used.has(c)) || WORKSPACE_COLORS[ctx.workspaces().length % WORKSPACE_COLORS.length],
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

function setColor(id, color) {
  if (HEX.test(color)) patch(id, (ws) => (ws.color = color));
}

function setIsolated(id, isolated) {
  patch(id, (ws) => (ws.isolated = Boolean(isolated)));
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

module.exports = { COLOR_NAMES, create, rename, setColor, setIsolated, remove };
