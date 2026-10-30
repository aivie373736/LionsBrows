import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const ICONS = [
  'arrow-left', 'arrow-right', 'rotate-cw', 'x', 'plus', 'search', 'shield', 'shield-off', 'shield-check', 'star',
  'panel-left', 'ellipsis', 'download', 'notebook-pen', 'volume-2', 'volume-x', 'pin', 'pin-off', 'settings',
  'history', 'bookmark', 'globe', 'lock', 'triangle-alert', 'house', 'copy', 'layers', 'columns-2', 'eye-off',
  'trash-2', 'folder-open', 'external-link', 'chevron-down', 'puzzle', 'moon', 'sun', 'calculator', 'terminal',
  'zap', 'command', 'sparkles', 'pause', 'play', 'file', 'arrow-up-right', 'corner-down-left', 'arrow-left-right',
  'moon-star', 'circle-check', 'circle-x', 'upload', 'info', 'monitor', 'palette', 'keyboard', 'zoom-in',
  'menu', 'image', 'film', 'check', 'sliders-horizontal', 'pencil', 'list', 'paintbrush',
  'book-open', 'import', 'refresh-cw', 'circle-arrow-up', 'languages', 'key-round', 'eye',
  'minus', 'sun-moon', 'store', 'code', 'cookie', 'camera', 'mic', 'map-pin', 'bell', 'undo-2', 'lock-open', 'ban', 'qr-code',
];

const lucideDir = path.join(path.dirname(require.resolve('lucide-static/package.json')), 'icons');
const entries = ICONS.map((name) => {
  const svg = fs.readFileSync(path.join(lucideDir, `${name}.svg`), 'utf8');
  const inner = svg
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .replace(/\s*\n\s*/g, '')
    .trim();
  return `  '${name}': '${inner.replace(/'/g, "\\'")}',`;
});

const out = `(function () {
  const ICONS = {
${entries.join('\n')}
  };
  function icon(name, size = 18, extra = '') {
    const body = ICONS[name] || '';
    return '<svg class="icon ' + extra + '" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
  }
  window.icon = icon;
})();
`;
fs.writeFileSync(path.join(root, 'src/shared/icons.js'), out);
console.log(`icons.js: ${ICONS.length} icons`);

const ENGINE_ICONS = ['google', 'duckduckgo', 'brave', 'ecosia', 'startpage', 'qwant', 'mojeek'];
const simpleIcons = path.join(root, 'node_modules/simple-icons/icons');
const brand = JSON.parse(fs.readFileSync(path.join(path.dirname(simpleIcons), 'data/simple-icons.json'), 'utf8'));
const brandList = Array.isArray(brand) ? brand : brand.icons;
const engines = ENGINE_ICONS.map((slug) => {
  const svg = fs.readFileSync(path.join(simpleIcons, `${slug}.svg`), 'utf8');
  const d = svg.match(/ d="([^"]+)"/)[1];
  const hex = brandList.find((i) => (i.slug || '') === slug || i.title.toLowerCase().replace(/[^a-z]/g, '') === slug)?.hex || '888888';
  return `  ${slug}: { color: '#${hex}', path: '${d}' },`;
});
fs.writeFileSync(
  path.join(root, 'src/shared/engines.js'),
  `window.ENGINE_ICONS = {\n${engines.join('\n')}\n};\n`,
);
console.log(`engines.js: ${ENGINE_ICONS.length} logos`);

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.log('playwright not found; skipping PNG icons');
  process.exit(0);
}

const logo = fs.readFileSync(path.join(root, 'src/shared/logo.svg'), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
async function render(size, file, { padding = 0.06, background = null } = {}) {
  await page.setViewportSize({ width: size, height: size });
  const pad = Math.round(size * padding);
  await page.setContent(
    `<html><body style="margin:0;background:${background || 'transparent'}"><div style="width:${size}px;height:${size}px;padding:${pad}px;box-sizing:border-box">${logo.replace('<svg ', '<svg width="100%" height="100%" ')}</div></body></html>`,
  );
  await page.screenshot({ path: file, omitBackground: !background });
  console.log('wrote', path.relative(root, file));
}
await render(1024, path.join(root, 'build/icon.png'));
await render(256, path.join(root, 'src/shared/icon.png'));
await browser.close();
