'use strict';

const { ACTIONS, run } = require('./actions');

const isMac = process.platform === 'darwin';

const CODE_NAMES = {
  Backslash: '\\',
  BracketLeft: '[',
  BracketRight: ']',
  Equal: '=',
  Minus: '-',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  NumpadAdd: '+',
  NumpadSubtract: '-',
};

const KEYMAP = new Map();
for (const [id, action] of Object.entries(ACTIONS)) {
  for (const combo of action.keys || []) KEYMAP.set(combo, id);
}

function codeName(code = '') {
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return code.slice(6);
  return CODE_NAMES[code] || null;
}

function comboNames(input) {
  const mods = [];
  if (isMac ? input.meta : input.control) mods.push('mod');
  if (isMac && input.control) mods.push('ctrl');
  if (input.alt) mods.push('alt');
  if (input.shift) mods.push('shift');
  const key = (input.key || '').toLowerCase();
  const names = [key];
  if (!/^[a-z]$/.test(key)) {
    const byCode = codeName(input.code);
    if (byCode && byCode !== key) names.push(byCode);
  }
  return names.map((n) => [...mods, n].join('+'));
}

function lookup(input) {
  for (const name of comboNames(input)) {
    const id = KEYMAP.get(name);
    if (id) return id;
  }
  return null;
}

const REPEATABLE = new Set(['zoomIn', 'zoomOut', 'nextTab', 'prevTab', 'findNext', 'findPrev', 'back', 'forward']);

function handle(win, input, event, { overlay = false } = {}) {
  if (input.type !== 'keyDown') return;
  if (input.key === 'Escape' && win.find.open && !overlay) {
    event.preventDefault();
    win.closeFind();
    return;
  }
  const id = lookup(input);
  if (!id) return;
  if (input.isAutoRepeat && !REPEATABLE.has(id)) {
    event.preventDefault();
    return;
  }
  if (overlay) {
    if (id === 'palette' || id === 'focusAddress') {
      event.preventDefault();
      win.closePalette();
    }
    return;
  }
  event.preventDefault();
  run(id, win);
}

module.exports = { handle, comboNames, lookup };
