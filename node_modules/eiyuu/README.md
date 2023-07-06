# Eiyuu [![Testing](https://github.com/sinkaroid/eiyuu/workflows/Typedata%20test/badge.svg)](https://github.com/sinkaroid/eiyuu/actions/workflows/mocha.yml) [![Maintainability](https://api.codeclimate.com/v1/badges/cc5309f61f1336368fd2/maintainability)](https://codeclimate.com/github/sinkaroid/eiyuu/maintainability)

<a href="https://github.com/sinkaroid/eiyuu/blob/master/CONTRIBUTING.md">Contributing</a> •
<a href="https://eiyuu.js.org/">Documentation</a> •
<a href="https://github.com/sinkaroid/eiyuu/issues/new/choose">Report Issues</a>

<a href="https://www.npmjs.com/package/eiyuu"><img align="right" src="https://cdn.discordapp.com/attachments/952117487166705747/1008503920651407470/eiyuu_.png" width="300"></a>

- [Eiyuu](#)
  - [The problem](#the-problem)
  - [The solution](#the-solution)
  - [Features](#features)
    - [Eiyuu vs. the Competition](#eiyuu-vs-the-competition)
  - [Installation](#getting-started)
    - [Prerequisites](#prerequisites)
  - [Documentation](#documentation)
    - [Quick example](#quick-example)
    - [Combine with another libs](#combine-eiyuu-with-another-libraries)
    - [Combine with the Rest](#Combine-eiyuu-with-the-Rest)
    - [Use as error handler](#Use-eiyuu-as-error-handler)
    - [The search returns](#the-search-returns)
    - [Running the tests](#testing)
  - [Webpack](#webpack)
  - [Limitations](#limitations)
  - [Pronunciation](#Pronunciation)
  - [Acknowledgements](./CLOSING_REMARKS.md)
  - [Legal](#legal)


## The problem
TL;DR use arbitrary query to consume imageboard API, each websites could using direct wildcards with asterisk symbols like `?tags=<SomeQuery>*`. The whole booru api does not have wildcard endpoint, that mean You cannot using arbitrary query to interact with. This library bringing the wildcard usage on JS/TS environment. 

## The solution
A query completion Booru imageboards module that uses wildcard for It's query resolver.
<center>
<table>
  <tr>
    <td align="center"><img src="https://cdn.discordapp.com/attachments/952117487166705747/1008355693255983144/rounded_corners_6.png" width="360px;" alt=""/><br />💻 What browser looks like</td>
    <td align="center"><img src="https://cdn.discordapp.com/attachments/952117487166705747/1008355692782030868/rounded_corners_7.png" width="360px;" alt=""/><br />🚀 This library also</td>


  </tr>
</table>
</center><br>
The completion works like a Search, It's uses wildcard but Pure scraping, and does not hit the API just works like a plugins will immediately resolve the arbitrary query. It's can be used in any JS Third-party libraries.

## Features

- Support 11 different boorus (check [base.ts](./src/base.ts))
- Pure scraping, does not hit the API endpoint
- Documented and tested
- Easy to use, check your intelisense

## Eiyuu vs. the Competition
Some tests result with the imageboards

| Site            | Status                                                                                                                                                                            | Query resolver | Additions |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | --- |
| `Danbooru`       | [![](https://github.com/sinkaroid/eiyuu/workflows/Danbooru%20test/badge.svg)](https://github.com/sinkaroid/eiyuu/actions/workflows/danbooru.yml) | `Yes` | Stable |
| `Gelbooru`       | [![](https://github.com/sinkaroid/eiyuu/workflows/Gelbooru%20test/badge.svg)](https://github.com/sinkaroid/eiyuu/actions/workflows/gelbooru.yml) | `Yes` | Stable |
| `Hypnohub`       | [![](https://github.com/sinkaroid/eiyuu/workflows/Hypnohub%20test/badge.svg)](https://github.com/sinkaroid/eiyuu/actions/workflows/hypnohub.yml) | `Yes` | Stable |
| `Konachan`       | [![](https://github.com/sinkaroid/eiyuu/workflows/Konachan%20test/badge.svg)](https://github.com/sinkaroid/eiyuu/actions/workflows/konachan.yml) | `Yes` | Stable |
| `Lolibooru`       | [![](https://github.com/sinkaroid/eiyuu/workflows/Lolibooru%20test/badge.svg)](https://github.com/sinkaroid/eiyuu/actions/workflows/lolibooru.yml) | `Yes` | Partial |
| `Rule34`       | [![](https://github.com/sinkaroid/eiyuu/workflows/Rule34%20test/badge.svg)](https://github.com/sinkaroid/eiyuu/actions/workflows/rule34.yml) | `Yes` | Captcha Enabled |
| `Realbooru`       | [![](https://github.com/sinkaroid/eiyuu/workflows/Realbooru%20test/badge.svg)](https://github.com/sinkaroid/eiyuu/actions/workflows/realbooru.yml) | `Yes` | Stable |
| `Safebooru`       | [![](https://github.com/sinkaroid/eiyuu/workflows/Safebooru%20test/badge.svg)](https://github.com/sinkaroid/eiyuu/actions/workflows/safebooru.yml) | `Yes` | Stable |
| `Tbib`       | [![](https://github.com/sinkaroid/eiyuu/workflows/Tbib%20test/badge.svg)](https://github.com/sinkaroid/eiyuu/actions/workflows/tbib.yml) | `Yes` | Stable |
| `Xbooru`       | [![](https://github.com/sinkaroid/eiyuu/workflows/Xbooru%20test/badge.svg)](https://github.com/sinkaroid/eiyuu/actions/workflows/xbooru.yml) | `Yes` | Partial |
| `Yandere`       | [![](https://github.com/sinkaroid/eiyuu/workflows/Yandere%20test/badge.svg)](https://github.com/sinkaroid/eiyuu/actions/workflows/yandere.yml) | `Yes` | Stable |

## Getting Started
`npm install eiyuu` / `yarn add eiyuu`

## Prerequisites
<table>
	<td><b>NOTE:</b> NodeJS 14.x or higher</td>
</table>

## Quick Example
Use the arbitrary query for `jeanne_d'arc_(fate)`
```js
import { Eiyuu } from "eiyuu";

const search = new Eiyuu();
search.danbooru("janne").then(res => {
    console.log(res); // Get the res[0] for the best match
});
```
commonjs: `const { Eiyuu } = require('eiyuu');`

You can passing optional useragent and follow redirects options.  
`constructor(useragent?: string, followRedirects?: boolean)`
```js
const search = new Eiyuu('eiyuu/version (eiyuu.js.org);', false);
```

## Combine Eiyuu with another libraries
Example combine eiyuu with JS Booru package [@AtoraSuunva/booru](https://www.npmjs.com/package/booru)
```js
const Booru = require('booru');
const { Eiyuu } = require('eiyuu');
const resolve = new Eiyuu();

async function Danbooru() {
    const query = await resolve.danbooru("jeanne"); // arbitrary request
    const dan = Booru.forSite('danbooru');
    dan.search(query[0], { limit: 10 }).then(posts => {
        console.log(posts);
    })
}

Danbooru();
```

## Combine Eiyuu with the Rest
Example use this module with direct request to the api
```js
const axios = require("axios");
const { Eiyuu } = require('eiyuu');
const resolve = new Eiyuu();

async function Danbooru() {
    const query = await resolve.danbooru("jeanne"); // arbitrary request
    const res = await axios.get(`https://danbooru.donmai.us/posts.json?limit=10&tags=${query[0]}`);
    console.log(res.data);
}

Danbooru();
```

## Use Eiyuu as error handler
Instead hanging when no results are found, You can tells the proper queries with `parseString()`
```js
const axios = require("axios"); // or any http client
const { Eiyuu, parseString } = require('eiyuu'); // import the wildcard
const resolve = new Eiyuu(); // default constructor
const q = "jeanne"; // assuming this is the query

async function Danbooru() {
    const res = await axios.get(`https://danbooru.donmai.us/posts.json?limit=10&tags=${q}`);

    // throw when error and tells the proper queries
    if (!res.data || res.data.length === 0) return resolve.danbooru(q).then(r => {
        console.log("No results found. Did you mean:", parseString(r));
    })

    // return when found
    console.log(res.data);

}

Danbooru();
```

## The search returns
The query resolved returned as array

```js
[
  "jeanne_d'arc_alter_(fate)",
  "jeanne_d'arc_(fate)",
  "jeanne_d'arc_alter_(avenger)_(fate)",
  "jeanne_d'arc_(ruler)_(fate)",
  "jeanne_d'arc_alter_(swimsuit_berserker)_(fate)",
  "jeanne_d'arc_alter_santa_lily_(fate)",
  "jeanne_d'arc_(swimsuit_archer)_(fate)"
] // and so on..
```

## Testing
Check workflows and the whole build script on [package.json](./package.json)

## Documentation
The documentation can be found https://sinkaroid.github.io/eiyuu

## Webpack
TBA

## Limitations
Depends on your request, Some sites has CF or captcha enabled. Rule34 for example, If they marked your IP for being spam Eiyuu's scraper will not work. Make sure your stuff run on good environments.


## Pronunciation
[`ja_JP`](https://www.localeplanet.com/java/ja-JP/index.html) • **/ei-yū/** Eiyuu / eiyū / 英雄 — hero; heroine; leads to the spirit hero probably; _(?)_


## Legal
This tool can be freely copied, modified, altered, distributed without any attribution whatsoever. However, if you feel
like this tool deserves an attribution, mention it. It won't hurt anybody.
> Licence: WTF.