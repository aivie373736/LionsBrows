'use strict';

const { execFileSync } = require('node:child_process');

module.exports = function vmpSign(context, platform) {
  if (context.electronPlatformName !== platform) return;
  if (!process.env.EVS_ACCOUNT_NAME) {
    console.log('  • skipping Widevine VMP signing: EVS_ACCOUNT_NAME is not set');
    return;
  }
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const env = { ...process.env, EVS_NO_ASK: '1' };
  execFileSync(python, ['-m', 'castlabs_evs.account', 'reauth'], { stdio: 'inherit', env });
  execFileSync(python, ['-m', 'castlabs_evs.vmp', 'sign-pkg', context.appOutDir], { stdio: 'inherit', env });
};
