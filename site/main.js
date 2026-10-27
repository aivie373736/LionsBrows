'use strict';

const DE = {
  'nav.features': 'Funktionen',
  'nav.download': 'Download',
  'hero.title': 'Der komplette Browser, ohne Ballast.',
  'hero.lead': 'LionsBrows ist ein schneller, privater Browser auf Basis von Chromium. Er hat alles, was du brauchst, bleibt im Hintergrund und läuft auch auf älteren Computern flüssig.',
  'hero.download': 'Herunterladen',
  'hero.source': 'Quellcode',
  'hero.fine': 'Kostenlos und Open Source · Windows, macOS und Linux',
  'features.title': 'Alles, was du brauchst. Nichts, was du nicht brauchst.',
  'f.minimal.t': 'Schlicht von Anfang an',
  'f.minimal.p': 'Zurück, Vorwärts, Neu laden, Adressleiste und ein Menü. Downloads, geteilte Ansicht und Notizen erscheinen nur, wenn du sie brauchst.',
  'f.privacy.t': 'Blockiert Werbung und Tracker',
  'f.privacy.p': 'Eingebauter Blocker, automatisches HTTPS, Global Privacy Control und private Fenster, die beim Schließen alles vergessen.',
  'f.memory.t': 'Sparsam mit Arbeitsspeicher',
  'f.memory.p': 'Inaktive Tabs ruhen automatisch, und auf Computern mit 4 GB RAM oder weniger schaltet sich ein Sparmodus von selbst ein.',
  'f.reader.t': 'Leseansicht',
  'f.reader.p': 'Ein Klick macht aus einem überladenen Artikel sauberen Text, in Hell, Sepia oder Dunkel.',
  'f.workspaces.t': 'Arbeitsbereiche und geteilte Ansicht',
  'f.workspaces.p': 'Trenne Arbeit und Privates, sogar mit getrennten Anmeldungen, und sieh zwei Seiten nebeneinander an.',
  'f.command.t': 'Befehlsleiste',
  'f.command.p': 'Mit Strg+K findest du offene Tabs, Lesezeichen, Verlauf und Einstellungen oder rechnest schnell etwas aus.',
  'f.import.t': 'Nimm deine Lesezeichen mit',
  'f.import.p': 'Importiere Lesezeichen und Verlauf aus Chrome, Edge, Brave, Vivaldi, Opera und Firefox.',
  'f.lang.t': 'Deutsch und Englisch',
  'f.lang.p': 'Der Browser folgt deiner Systemsprache, und du kannst jederzeit wechseln.',
  'f.custom.t': 'Ganz nach deinem Geschmack',
  'f.custom.p': 'Dein eigenes Video, Bild oder deine Farbe als Hintergrund, jede Akzentfarbe und Tabs oben oder an der Seite.',
  'g.reader': 'Leseansicht',
  'g.vertical': 'Tabs an der Seite, in deinen Farben',
  'g.video': 'Dein eigenes Video als Hintergrund',
  'd.title': 'LionsBrows herunterladen',
  'd.windows': 'Windows 10 und 11',
  'd.get': 'Herunterladen',
  'd.winarm': 'Für ARM-Laptops',
  'd.mac': 'Apple Silicon (M1 und neuer)',
  'd.macintel': 'Für Intel-Macs',
  'd.linux': 'AppImage, 64 Bit',
  'd.linuxarm': 'Für ARM (Raspberry Pi 4/5)',
  'd.note': 'LionsBrows ist noch nicht signiert, deshalb zeigt Windows eventuell „Der Computer wurde durch Windows geschützt“. Klicke auf <b>Weitere Informationen</b> und dann auf <b>Trotzdem ausführen</b>. Unter macOS öffnest du die App mit einem Rechtsklick und <b>Öffnen</b>.',
  'footer.license': 'MIT-Lizenz',
  'footer.releases': 'Alle Versionen',
  'footer.github': 'GitHub',
  'download.windows': 'Für Windows herunterladen',
  'download.mac': 'Für macOS herunterladen',
  'download.linux': 'Für Linux herunterladen',
};

const EN = {
  'download.windows': 'Download for Windows',
  'download.mac': 'Download for macOS',
  'download.linux': 'Download for Linux',
};

const originals = new Map();
for (const node of document.querySelectorAll('[data-i18n]')) originals.set(node, node.innerHTML);

let lang = 'en';
let platform = null;

function text(key) {
  return (lang === 'de' ? DE : EN)[key];
}

function apply() {
  document.documentElement.lang = lang;
  for (const [node, html] of originals) node.innerHTML = lang === 'de' && DE[node.dataset.i18n] ? DE[node.dataset.i18n] : html;
  document.getElementById('lang').textContent = lang === 'de' ? 'EN' : 'DE';
  document.getElementById('lang').setAttribute('aria-label', lang === 'de' ? 'Switch to English' : 'Auf Deutsch wechseln');
  if (platform) document.querySelector('#main-download span').textContent = text(`download.${platform.os}`);
}

function detectBasic() {
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return { os: 'windows', asset: /ARM64|aarch64/i.test(ua) ? 'win-arm64' : 'win-x64' };
  if (/Mac OS X|Macintosh/i.test(ua) && !/iPhone|iPad/i.test(ua)) return { os: 'mac', asset: 'mac-arm64' };
  if (/Linux/i.test(ua) && !/Android/i.test(ua)) return { os: 'linux', asset: /aarch64|arm64/i.test(ua) ? 'linux-arm64' : 'linux-x86_64' };
  return null;
}

async function detect() {
  const found = detectBasic();
  if (!found || !navigator.userAgentData?.getHighEntropyValues) return found;
  try {
    const { architecture } = await navigator.userAgentData.getHighEntropyValues(['architecture']);
    if (found.os === 'windows') found.asset = architecture === 'arm' ? 'win-arm64' : 'win-x64';
    if (found.os === 'mac') found.asset = architecture === 'x86' ? 'mac-x64' : 'mac-arm64';
  } catch {
  }
  return found;
}

function showPlatform(found) {
  platform = found;
  if (!found) return;
  const link = document.querySelector(`[data-asset="${found.asset}"]`);
  const button = document.getElementById('main-download');
  if (link) button.href = link.href;
  document.querySelector(`.platform[data-os="${found.os}"]`)?.classList.add('detected');
  document.querySelector('.platforms').classList.add('has-detected');
  apply();
}

document.getElementById('lang').addEventListener('click', () => {
  lang = lang === 'de' ? 'en' : 'de';
  try {
    localStorage.setItem('lang', lang);
  } catch {
  }
  apply();
});

let saved = null;
try {
  saved = localStorage.getItem('lang');
} catch {
}
lang = saved || ((navigator.language || '').toLowerCase().startsWith('de') ? 'de' : 'en');
apply();
detect().then(showPlatform);
