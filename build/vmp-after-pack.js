'use strict';

const vmpSign = require('./vmp');

exports.default = (context) => vmpSign(context, 'darwin');
