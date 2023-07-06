"use strict";
// A wildcard import would result in a `require("puppeteer")` statement
// at the top of the transpiled js file, not what we want. :-/
// "import type" is a solution here but requires TS >= v3.8 which we don't want to require yet as a minimum.
Object.defineProperty(exports, "__esModule", { value: true });
exports.Target = exports.Page = exports.Browser = void 0;
var puppeteer_1 = require("puppeteer");
Object.defineProperty(exports, "Browser", { enumerable: true, get: function () { return puppeteer_1.Browser; } });
var puppeteer_2 = require("puppeteer");
Object.defineProperty(exports, "Page", { enumerable: true, get: function () { return puppeteer_2.Page; } });
var puppeteer_3 = require("puppeteer");
Object.defineProperty(exports, "Target", { enumerable: true, get: function () { return puppeteer_3.Target; } });
//# sourceMappingURL=puppeteer.js.map