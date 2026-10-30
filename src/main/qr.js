'use strict';

function svg(text) {
  const factory = require('qrcode-generator');
  const qr = (factory.default || factory)(0, 'M');
  try {
    qr.addData(text, 'Byte');
    qr.make();
  } catch {
    return null;
  }
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

module.exports = { svg };
