# stable-diffusion-cjs

This is a CJS version of [this](https://www.npmjs.com/package/stable-diffusion-es) ES module for [Node.js](https://nodejs.org/en/) that provides uses Stable Diffusion to generate images from a given prompt using AI.

## Installation

```bash
npm install stable-diffusion-cjs
```

## Usage

```js
const AI = require("stable-diffusion-cjs")
const fs = require("fs")

let prompt = "A cat"

 AI.generate(prompt, async (result) => {
    if (result.error) {
        console.log(result.error)
        return;
    }
    try {
        for (let i = 0; i < result.results.length; i++) {
            let data = result.results[i].split(",")[1]
            const buffer = Buffer.from(data, "base64")
            const filename = `image_${i + 1}.png`
            fs.writeFileSync(filename, buffer)
        }
    } catch (e) {
        console.log(e)
    }
})
```
A trick to get better images is to add: 
```
{enhanced}
```
at the end of your prompt.

## Output

![A cat](https://media.discordapp.net/attachments/1044317518975733810/1066794811597799424/image_3.png?width=384&height=384)



