'use strict';

const { ctx } = require('./context');

const WORLD = 1012;

const TOGGLE = `(async () => {
  if (document.pictureInPictureElement) {
    await document.exitPictureInPicture();
    return 'exit';
  }
  const area = (v) => {
    const r = v.getBoundingClientRect();
    return r.width * r.height;
  };
  const videos = [...document.querySelectorAll('video')].filter((v) => v.readyState > 0 && !v.disablePictureInPicture).sort((a, b) => area(b) - area(a));
  const pick = videos.find((v) => !v.paused) || videos[0];
  if (!pick) return 'none';
  await pick.requestPictureInPicture();
  return 'enter';
})()`;

const AUTO = `(async () => {
  if (document.pictureInPictureElement) return false;
  const video = [...document.querySelectorAll('video')].find((v) => {
    const r = v.getBoundingClientRect();
    return !v.paused && !v.ended && !v.muted && v.volume > 0 && !v.disablePictureInPicture && r.width >= 200 && r.height >= 110;
  });
  if (!video) return false;
  await video.requestPictureInPicture();
  return true;
})()`;

function run(tab, code) {
  if (!tab?.wc) return Promise.resolve(null);
  return tab.wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code }], true).catch(() => null);
}

function togglePip(tab) {
  return run(tab, TOGGLE);
}

function switched(w, prev, next) {
  if (next?.autoPip) {
    next.autoPip = false;
    run(next, 'document.pictureInPictureElement ? document.exitPictureInPicture().then(() => true) : false');
  }
  if (!prev || prev === next || !prev.audible || prev.muted || !ctx.settings().autoPictureInPicture || w.visibleTabs().includes(prev)) return;
  run(prev, AUTO).then((entered) => {
    if (entered) prev.autoPip = true;
  });
}

module.exports = { togglePip, switched };
