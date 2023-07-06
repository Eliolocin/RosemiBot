"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ava_1 = __importDefault(require("ava"));
const _1 = require(".");
(0, ava_1.default)('is a function', async (t) => {
    t.is(typeof _1.PuppeteerExtraPlugin, 'function');
});
(0, ava_1.default)('will throw without a name', async (t) => {
    class Derived extends _1.PuppeteerExtraPlugin {
    }
    const error = await t.throws(() => new Derived());
    t.is(error.message, `Plugin must override "name"`);
});
(0, ava_1.default)('should have the basic class members', async (t) => {
    const pluginName = 'hello-world';
    class Plugin extends _1.PuppeteerExtraPlugin {
        constructor(opts = {}) {
            super(opts);
        }
        get name() {
            return pluginName;
        }
    }
    const instance = new Plugin();
    t.is(instance.name, pluginName);
    t.true(instance.requirements instanceof Set);
    t.true(instance.dependencies instanceof Set);
    t.true(instance.data instanceof Array);
    t.true(instance.defaults instanceof Object);
    t.is(instance.data.length, 0);
    t.true(instance.debug instanceof Function);
    t.is(instance.debug.namespace, `puppeteer-extra-plugin:${pluginName}`);
    t.true(instance._isPuppeteerExtraPlugin);
});
(0, ava_1.default)('should have the public class members', async (t) => {
    const pluginName = 'hello-world';
    class Plugin extends _1.PuppeteerExtraPlugin {
        constructor(opts = {}) {
            super(opts);
        }
        get name() {
            return pluginName;
        }
    }
    const instance = new Plugin();
    t.true(instance.beforeLaunch instanceof Function);
    t.true(instance.afterLaunch instanceof Function);
    t.true(instance.onTargetCreated instanceof Function);
    t.true(instance.onBrowser instanceof Function);
    t.true(instance.onPageCreated instanceof Function);
    t.true(instance.onTargetChanged instanceof Function);
    t.true(instance.onTargetDestroyed instanceof Function);
    t.true(instance.onDisconnected instanceof Function);
    t.true(instance.onClose instanceof Function);
    t.true(instance.onPluginRegistered instanceof Function);
    t.true(instance.getDataFromPlugins instanceof Function);
});
(0, ava_1.default)('should have the internal class members', async (t) => {
    const pluginName = 'hello-world';
    class Plugin extends _1.PuppeteerExtraPlugin {
        constructor(opts = {}) {
            super(opts);
        }
        get name() {
            return pluginName;
        }
    }
    const instance = new Plugin();
    t.true(instance._getMissingDependencies instanceof Function);
    t.true(instance._bindBrowserEvents instanceof Function);
    t.true(instance._onTargetCreated instanceof Function);
    t.true(instance._register instanceof Function);
    t.true(instance._registerChildClassMembers instanceof Function);
    t.true(instance._hasChildClassMember instanceof Function);
});
(0, ava_1.default)('should merge opts with defaults automatically', async (t) => {
    const pluginName = 'hello-world';
    const pluginDefaults = { foo: 'bar', foo2: 'bar2', extra1: 123 };
    const userOpts = { foo2: 'bob', extra2: 666 };
    class Plugin extends _1.PuppeteerExtraPlugin {
        constructor(opts = {}) {
            super(opts);
        }
        get name() {
            return pluginName;
        }
        get defaults() {
            return pluginDefaults;
        }
    }
    const instance = new Plugin(userOpts);
    t.deepEqual(instance.defaults, pluginDefaults);
    t.is(instance.opts.foo, pluginDefaults.foo);
    t.is(instance.opts.foo2, userOpts.foo2);
    t.is(instance.opts.extra1, pluginDefaults.extra1);
    t.is(instance.opts.extra2, userOpts.extra2);
});
(0, ava_1.default)('should have opts when defaults is not defined', async (t) => {
    const pluginName = 'hello-world';
    const userOpts = { foo2: 'bob', extra2: 666 };
    class Plugin extends _1.PuppeteerExtraPlugin {
        constructor(opts = {}) {
            super(opts);
        }
        get name() {
            return pluginName;
        }
    }
    const instance = new Plugin(userOpts);
    t.deepEqual(instance.opts, userOpts);
});
//# sourceMappingURL=index.test.js.map