# Third-party notices

LionsBrows includes or depends on the following open-source software.

## Lucide icons

`src/shared/icons.js` contains icons from [Lucide](https://lucide.dev).

```
ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

## Simple Icons

The search engine logos in `src/shared/engines.js` come from [Simple Icons](https://simpleicons.org), released under CC0 1.0. Brand logos remain trademarks of their owners.

## Ghostery adblocker

Ad and tracker blocking uses [@ghostery/adblocker](https://github.com/ghostery/adblocker), licensed under MPL-2.0.

## Mozilla Readability

Reader view uses [Readability](https://github.com/mozilla/readability) by Mozilla, licensed under Apache-2.0.

## electron-chrome-extensions

Chrome extension support uses [electron-chrome-extensions](https://github.com/samuelmaddock/electron-browser-shell) by Samuel Maddock (MIT).

## fflate

Extension packages are unpacked with [fflate](https://github.com/101arrowz/fflate) (MIT).

## Phishing and malware lists

Warnings about dangerous sites use lists that LionsBrows downloads while it runs: the [Phishing URL Blocklist](https://gitlab.com/malware-filter/phishing-filter) (CC BY-SA 4.0, with data from OpenPhish, PhishTank and IPThreat), the [Online Malicious URL Blocklist](https://gitlab.com/malware-filter/urlhaus-filter) (with data from [URLhaus](https://urlhaus.abuse.ch), CC0) and [uBlock Origin's badware list](https://github.com/uBlockOrigin/uAssets) (GPL-3.0).

## electron-updater

Automatic updates use [electron-updater](https://github.com/electron-userland/electron-builder) (MIT).

## Electron and Chromium

LionsBrows is built on [Electron for Content Security](https://github.com/castlabs/electron-releases) by castLabs, a fork of [Electron](https://www.electronjs.org) (MIT) and [Chromium](https://www.chromium.org) (BSD-style). Their license files ship with every build.

## Widevine

The Widevine Content Decryption Module is proprietary software by Google. It is not part of LionsBrows; it is downloaded from Google on first launch through Chromium's component updater.
