'use strict';

const os = require('node:os');
const { app } = require('electron');
const { ctx } = require('./context');

const GB = 1024 ** 3;
const MINUTE = 60_000;

const PROFILES = {
  off: { sleepAfter: 0, maxAwake: Infinity, onPressure: false },
  balanced: { sleepAfter: 30, maxAwake: 12, onPressure: true },
  maximum: { sleepAfter: 5, maxAwake: 3, onPressure: true },
};

let timer = null;
let pending = null;

function isLowEndDevice() {
  return os.totalmem() <= 4 * GB;
}

function profile() {
  const mode = ctx.settings().memorySaver;
  if (mode !== 'auto') return PROFILES[mode] || PROFILES.balanced;
  if (isLowEndDevice()) return PROFILES.maximum;
  if (os.totalmem() <= 8 * GB) return { ...PROFILES.balanced, sleepAfter: 15, maxAwake: 8 };
  return PROFILES.balanced;
}

function underPressure() {
  const free = os.freemem();
  return free < 300 * 1024 ** 2 || free / os.totalmem() < 0.08;
}

function backgroundTabs() {
  const tabs = [];
  for (const w of ctx.windows) {
    const visible = new Set(w.visibleTabs());
    for (const t of w.allTabs()) if (t.view && !visible.has(t)) tabs.push(t);
  }
  return tabs.sort((a, b) => b.lastActive - a.lastActive);
}

function enforce({ pressure = false } = {}) {
  const p = profile();
  const now = Date.now();
  let slept = 0;
  let awake = 0;
  for (const t of backgroundTabs()) {
    if (t.audible) continue;
    const idle = p.sleepAfter && !t.loading && now - t.lastActive > p.sleepAfter * MINUTE;
    const overLimit = awake >= p.maxAwake;
    if ((idle || overLimit || (pressure && p.onPressure)) && t.sleep()) slept++;
    else awake++;
  }
  return slept;
}

function schedule() {
  clearTimeout(pending);
  pending = setTimeout(() => enforce(), 1500);
}

function sleepAllBackground() {
  let slept = 0;
  for (const t of backgroundTabs()) if (t.sleep()) slept++;
  return slept;
}

function start() {
  if (timer) return;
  timer = setInterval(() => enforce({ pressure: underPressure() }), 20_000);
}

function describe(p) {
  if (!p.sleepAfter && p.maxAwake === Infinity) return 'Tabs are never put to sleep.';
  const parts = [];
  if (p.sleepAfter) parts.push(`Inactive tabs sleep after ${p.sleepAfter} minutes`);
  if (p.maxAwake !== Infinity) parts.push(`at most ${p.maxAwake} background tabs stay active`);
  return `${parts.join(', ')}.`;
}

function report() {
  const metrics = app.getAppMetrics();
  const byPid = new Map(metrics.map((m) => [m.pid, (m.memory?.workingSetSize || 0) * 1024]));
  const pidCount = new Map();
  const tabs = [];
  for (const w of ctx.windows) {
    const visible = new Set(w.visibleTabs());
    for (const t of w.allTabs()) {
      const pid = t.wc ? t.wc.getOSProcessId() : 0;
      if (pid) pidCount.set(pid, (pidCount.get(pid) || 0) + 1);
      tabs.push({ id: t.id, title: t.title || t.displayUrl, url: t.displayUrl, favicon: t.favicon, sleeping: t.sleeping, visible: visible.has(t), isPrivate: w.isPrivate, pid });
    }
  }
  for (const tab of tabs) {
    tab.memory = tab.pid ? byPid.get(tab.pid) || 0 : 0;
    tab.shared = tab.pid ? pidCount.get(tab.pid) > 1 : false;
  }
  tabs.sort((a, b) => b.memory - a.memory);
  const p = profile();
  return {
    total: [...byPid.values()].reduce((a, b) => a + b, 0),
    system: { total: os.totalmem(), free: os.freemem() },
    lowEndDevice: isLowEndDevice(),
    lowEndModeActive: Boolean(ctx.lowEndModeActive),
    summary: describe(p),
    tabs: tabs.map(({ pid, ...rest }) => rest),
  };
}

function sleepTab(id) {
  for (const w of ctx.windows) {
    const tab = w.tabById(id);
    if (tab) return w.visibleTabs().includes(tab) ? false : tab.sleep();
  }
  return false;
}

module.exports = { start, enforce, schedule, sleepAllBackground, sleepTab, report, profile, isLowEndDevice, underPressure, GB };
