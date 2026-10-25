'use strict';

const fs = require('node:fs');
const path = require('node:path');

class JsonStore {
  constructor(file, defaults = {}) {
    this.file = file;
    this.defaults = defaults;
    this.timer = null;
    this.data = this.#load();
  }

  #load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return mergeDefaults(structuredClone(this.defaults), raw);
    } catch {
      return structuredClone(this.defaults);
    }
  }

  get(key) {
    return key === undefined ? this.data : this.data[key];
  }

  set(key, value) {
    this.data[key] = value;
    this.save();
  }

  update(fn) {
    fn(this.data);
    this.save();
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 400);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}

function mergeDefaults(defaults, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaults;
  for (const [k, v] of Object.entries(raw)) {
    const d = defaults[k];
    if (d && typeof d === 'object' && !Array.isArray(d) && v && typeof v === 'object' && !Array.isArray(v)) {
      defaults[k] = { ...d, ...v };
    } else {
      defaults[k] = v;
    }
  }
  return defaults;
}

module.exports = { JsonStore, mergeDefaults };
