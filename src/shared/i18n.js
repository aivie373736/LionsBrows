(function () {
  const lang = window.LIONS_LANG || new URLSearchParams(location.search).get('lang') || 'en';
  const strings = lang === 'en' ? {} : window.LIONS_STRINGS || {};
  const has = (key) => Object.prototype.hasOwnProperty.call(strings, key);

  function tr(text, vars) {
    let out = has(text) ? strings[text] : text;
    if (vars) out = out.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match));
    return out;
  }

  function translateTree(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const key = node.nodeValue.trim();
      if (key && has(key)) node.nodeValue = node.nodeValue.replace(key, strings[key]);
    }
    for (const node of root.querySelectorAll('[title], [placeholder], [aria-label]')) {
      for (const attr of ['title', 'placeholder', 'aria-label']) {
        const value = node.getAttribute(attr);
        if (value && has(value)) node.setAttribute(attr, strings[value]);
      }
    }
  }

  window.tr = tr;
  window.LANG = lang;
  window.LOCALE = lang === 'de' ? 'de-DE' : 'en-US';
  document.documentElement.lang = lang;
  if (lang !== 'en') {
    translateTree(document.body || document.documentElement);
    document.title = tr(document.title);
  }
})();
