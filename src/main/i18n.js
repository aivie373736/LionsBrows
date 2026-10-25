'use strict';

const { app } = require('electron');

const LANGUAGES = ['en', 'de'];
const DICTIONARIES = { de: () => require('../shared/locales/de.js') };

let setting = 'auto';
let resolved = null;
let strings = null;

function configure(value) {
  setting = LANGUAGES.includes(value) ? value : 'auto';
  resolved = null;
  strings = null;
}

function systemLanguage() {
  try {
    const preferred = app.getPreferredSystemLanguages?.() || [];
    const first = String(preferred[0] || app.getLocale() || '').toLowerCase();
    return LANGUAGES.find((l) => first.startsWith(l)) || 'en';
  } catch {
    return 'en';
  }
}

function lang() {
  if (!resolved) resolved = setting === 'auto' ? systemLanguage() : setting;
  return resolved;
}

function dictionary() {
  if (!strings) strings = DICTIONARIES[lang()] ? DICTIONARIES[lang()]() : {};
  return strings;
}

function tr(text, vars) {
  const dict = dictionary();
  let out = Object.prototype.hasOwnProperty.call(dict, text) ? dict[text] : text;
  if (vars) out = out.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match));
  return out;
}

function locale() {
  return lang() === 'de' ? 'de-DE' : 'en-US';
}

function script() {
  const head = `window.LIONS_LANG = ${JSON.stringify(lang())};\n`;
  if (lang() === 'en') return head;
  const fs = require('node:fs');
  const path = require('node:path');
  return head + fs.readFileSync(path.join(__dirname, '..', 'shared', 'locales', `${lang()}.js`), 'utf8');
}

module.exports = { configure, lang, tr, locale, script, LANGUAGES };
