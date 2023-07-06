# @distube/ytdl-core

DisTube fork of `ytdl-core`. This fork is dedicated to fix bugs and add features that are not merged to the original repo as soon as possible.

# Installation

```bash
npm install @distube/ytdl-core@latest
```

Or for Yarn users:

```bash
yarn add @distube/ytdl-core@latest
```

Make sure you're installing the latest version of `@distube/ytdl-core` to keep up with the latest fixes.

# Usage

All the usage is the same as the original repo, except for the installation part.

```js
const fs = require("fs");
const ytdl = require("@distube/ytdl-core");
// TypeScript: import ytdl from '@distube/ytdl-core'; with --esModuleInterop
// TypeScript: import * as ytdl from '@distube/ytdl-core'; with --allowSyntheticDefaultImports
// TypeScript: import ytdl = require('@distube/ytdl-core'); with neither of the above

ytdl("http://www.youtube.com/watch?v=aqz-KE-bpKQ").pipe(fs.createWriteStream("video.mp4"));
```

# API

You can find the API documentation in the [original repo](https://github.com/fent/node-ytdl-core#api)

## Limitations

ytdl cannot download videos that fall into the following

- Regionally restricted (requires a [proxy](example/proxy.js))
- Private (if you have access, requires [cookies](example/cookies.js))
- Rentals (if you have access, requires [cookies](example/cookies.js))
- YouTube Premium content (if you have access, requires [cookies](example/cookies.js))
- Only [HLS Livestreams](https://en.wikipedia.org/wiki/HTTP_Live_Streaming) are currently supported. Other formats will get filtered out in ytdl.chooseFormats

Generated download links are valid for 6 hours, and may only be downloadable from the same IP address.

## Ratelimits

When doing to many requests YouTube might block. This will result in your requests getting denied with HTTP-StatusCode 429. The following Steps might help you:

- Update `@distube/ytdl-core` to the latest version
- Use proxies (you can find an example [here](https://github.com/fent/node-ytdl-core/blob/master/example/proxy.js))
- Extend on the Proxy Idea by rotating (IPv6-)Addresses
  - read [this](#How-does-using-an-IPv6-block-help?) for more information about this
- Use cookies (you can find an example [here](https://github.com/fent/node-ytdl-core/blob/master/example/cookies.js))
  - for this to take effect you have to FIRST wait for the current ratelimit to expire
- Wait it out (it usually goes away within a few days)

## Update Checks

The issue of using an outdated version of ytdl-core became so prevalent, that ytdl-core now checks for updates at run time, and every 12 hours. If it finds an update, it will print a warning to the console advising you to update. Due to the nature of this library, it is important to always use the latest version as YouTube continues to update.

If you'd like to disable this update check, you can do so by providing the `YTDL_NO_UPDATE` env variable.

```
env YTDL_NO_UPDATE=1 node myapp.js
```

# Related Projects

- [DisTube](https://github.com/skick1234/DisTube) - A Discord.js module to simplify your music commands and play songs with audio filters on Discord without any API key.
- [@distube/ytsr](https://github.com/distubejs/ytsr) - DisTube fork of [ytsr](https://github.com/TimeForANinja/node-ytsr).
- [@distube/ytpl](https://github.com/distubejs/ytpl) - DisTube fork of [ytpl](https://github.com/TimeForANinja/node-ytpl).
