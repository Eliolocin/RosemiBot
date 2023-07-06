/// <reference path="../dist/puppeteer-legacy.d.ts" />
import { PuppeteerNode } from 'puppeteer';
/**
 * Original Puppeteer API
 * @private
 */
export interface VanillaPuppeteer extends Pick<PuppeteerNode, 'connect' | 'defaultArgs' | 'executablePath' | 'launch' | 'createBrowserFetcher'> {
}
/**
 * Minimal plugin interface
 * @private
 */
export interface PuppeteerExtraPlugin {
    _isPuppeteerExtraPlugin: boolean;
    [propName: string]: any;
}
/**
 * Modular plugin framework to teach `puppeteer` new tricks.
 *
 * This module acts as a drop-in replacement for `puppeteer`.
 *
 * Allows PuppeteerExtraPlugin's to register themselves and
 * to extend puppeteer with additional functionality.
 *
 * @class PuppeteerExtra
 * @implements {VanillaPuppeteer}
 *
 * @example
 * const puppeteer = require('puppeteer-extra')
 * puppeteer.use(require('puppeteer-extra-plugin-anonymize-ua')())
 * puppeteer.use(require('puppeteer-extra-plugin-font-size')({defaultFontSize: 18}))
 *
 * ;(async () => {
 *   const browser = await puppeteer.launch({headless: false})
 *   const page = await browser.newPage()
 *   await page.goto('http://example.com', {waitUntil: 'domcontentloaded'})
 *   await browser.close()
 * })()
 */
export declare class PuppeteerExtra implements VanillaPuppeteer {
    private _pptr?;
    private _requireError?;
    private _plugins;
    constructor(_pptr?: VanillaPuppeteer | undefined, _requireError?: Error | undefined);
    /**
     * The **main interface** to register `puppeteer-extra` plugins.
     *
     * @example
     * puppeteer.use(plugin1).use(plugin2)
     *
     * @see [PuppeteerExtraPlugin]
     *
     * @return The same `PuppeteerExtra` instance (for optional chaining)
     */
    use(plugin: PuppeteerExtraPlugin): this;
    /**
     * To stay backwards compatible with puppeteer's (and our) default export after adding `addExtra`
     * we need to defer the check if we have a puppeteer instance to work with.
     * Otherwise we would throw even if the user intends to use their non-standard puppeteer implementation.
     *
     * @private
     */
    get pptr(): VanillaPuppeteer;
    /**
     * The method launches a browser instance with given arguments. The browser will be closed when the parent node.js process is closed.
     *
     * Augments the original `puppeteer.launch` method with plugin lifecycle methods.
     *
     * All registered plugins that have a `beforeLaunch` method will be called
     * in sequence to potentially update the `options` Object before launching the browser.
     *
     * @example
     * const browser = await puppeteer.launch({
     *   headless: false,
     *   defaultViewport: null
     * })
     *
     * @param options - See [puppeteer docs](https://github.com/puppeteer/puppeteer/blob/master/docs/api.md#puppeteerlaunchoptions).
     */
    launch(options?: Parameters<VanillaPuppeteer['launch']>[0]): ReturnType<VanillaPuppeteer['launch']>;
    /**
     * Attach Puppeteer to an existing Chromium instance.
     *
     * Augments the original `puppeteer.connect` method with plugin lifecycle methods.
     *
     * All registered plugins that have a `beforeConnect` method will be called
     * in sequence to potentially update the `options` Object before launching the browser.
     *
     * @param options - See [puppeteer docs](https://github.com/puppeteer/puppeteer/blob/master/docs/api.md#puppeteerconnectoptions).
     */
    connect(options: Parameters<VanillaPuppeteer['connect']>[0]): ReturnType<VanillaPuppeteer['connect']>;
    /**
     * The default flags that Chromium will be launched with.
     *
     * @param options - See [puppeteer docs](https://github.com/puppeteer/puppeteer/blob/master/docs/api.md#puppeteerdefaultargsoptions).
     */
    defaultArgs(options?: Parameters<VanillaPuppeteer['defaultArgs']>[0]): ReturnType<VanillaPuppeteer['defaultArgs']>;
    /** Path where Puppeteer expects to find bundled Chromium. */
    executablePath(): string;
    /**
     * This methods attaches Puppeteer to an existing Chromium instance.
     *
     * @param options - See [puppeteer docs](https://github.com/puppeteer/puppeteer/blob/master/docs/api.md#puppeteercreatebrowserfetcheroptions).
     */
    createBrowserFetcher(options: Parameters<VanillaPuppeteer['createBrowserFetcher']>[0]): ReturnType<VanillaPuppeteer['createBrowserFetcher']>;
    /**
     * Patch page creation methods (both regular and incognito contexts).
     *
     * Unfortunately it's possible that the `targetcreated` events are not triggered
     * early enough for listeners (e.g. plugins using `onPageCreated`) to be able to
     * modify the page instance (e.g. user-agent) before the browser request occurs.
     *
     * This only affects the first request of a newly created page target.
     *
     * As a workaround I've noticed that navigating to `about:blank` (again),
     * right after a page has been created reliably fixes this issue and adds
     * no noticable delay or side-effects.
     *
     * This problem is not specific to `puppeteer-extra` but default Puppeteer behaviour.
     *
     * Note: This patch only fixes explicitly created pages, implicitly created ones
     * (e.g. through `window.open`) are still subject to this issue. I didn't find a
     * reliable mitigation for implicitly created pages yet.
     *
     * Puppeteer issues:
     * https://github.com/GoogleChrome/puppeteer/issues/2669
     * https://github.com/puppeteer/puppeteer/issues/3667
     * https://github.com/GoogleChrome/puppeteer/issues/386#issuecomment-343059315
     * https://github.com/GoogleChrome/puppeteer/issues/1378#issue-273733905
     *
     * @private
     */
    private _patchPageCreationMethods;
    /**
     * Get a list of all registered plugins.
     *
     * @member {Array<PuppeteerExtraPlugin>}
     */
    get plugins(): PuppeteerExtraPlugin[];
    /**
     * Get the names of all registered plugins.
     *
     * @member {Array<string>}
     * @private
     */
    get pluginNames(): any[];
    /**
     * Collects the exposed `data` property of all registered plugins.
     * Will be reduced/flattened to a single array.
     *
     * Can be accessed by plugins that listed the `dataFromPlugins` requirement.
     *
     * Implemented mainly for plugins that need data from other plugins (e.g. `user-preferences`).
     *
     * @see [PuppeteerExtraPlugin]/data
     * @param name - Filter data by optional plugin name
     *
     * @private
     */
    getPluginData(name?: string): any[];
    /**
     * Get all plugins that feature a given property/class method.
     *
     * @private
     */
    private getPluginsByProp;
    /**
     * Lightweight plugin dependency management to require plugins and code mods on demand.
     *
     * This uses the `dependencies` stanza (a `Set`) exposed by `puppeteer-extra` plugins.
     *
     * @todo Allow objects as depdencies that contains opts for the requested plugin.
     *
     * @private
     */
    private resolvePluginDependencies;
    /**
     * Order plugins that have expressed a special placement requirement.
     *
     * This is useful/necessary for e.g. plugins that depend on the data from other plugins.
     *
     * @todo Support more than 'runLast'.
     * @todo If there are multiple plugins defining 'runLast', sort them depending on who depends on whom. :D
     *
     * @private
     */
    private orderPlugins;
    /**
     * Lightweight plugin requirement checking.
     *
     * The main intent is to notify the user when a plugin won't work as expected.
     *
     * @todo This could be improved, e.g. be evaluated by the plugin base class.
     *
     * @private
     */
    private checkPluginRequirements;
    /**
     * Call plugins sequentially with the same values.
     * Plugins that expose the supplied property will be called.
     *
     * @param prop - The plugin property to call
     * @param values - Any number of values
     * @private
     */
    private callPlugins;
    /**
     * Call plugins sequentially and pass on a value (waterfall style).
     * Plugins that expose the supplied property will be called.
     *
     * The plugins can either modify the value or return an updated one.
     * Will return the latest, updated value which ran through all plugins.
     *
     * @param prop - The plugin property to call
     * @param value - Any value
     * @return The new updated value
     * @private
     */
    private callPluginsWithValue;
}
/**
 * The **default export** will behave exactly the same as the regular puppeteer
 * (just with extra plugin functionality) and can be used as a drop-in replacement.
 *
 * Behind the scenes it will try to require either `puppeteer`
 * or [`puppeteer-core`](https://github.com/puppeteer/puppeteer/blob/master/docs/api.md#puppeteer-vs-puppeteer-core)
 * from the installed dependencies.
 *
 * @example
 * // javascript import
 * const puppeteer = require('puppeteer-extra')
 *
 * // typescript/es6 module import
 * import puppeteer from 'puppeteer-extra'
 *
 * // Add plugins
 * puppeteer.use(...)
 */
declare const defaultExport: PuppeteerExtra;
export default defaultExport;
/**
 * An **alternative way** to use `puppeteer-extra`: Augments the provided puppeteer with extra plugin functionality.
 *
 * This is useful in case you need multiple puppeteer instances with different plugins or to add plugins to a non-standard puppeteer package.
 *
 * @example
 * // js import
 * const { addExtra } = require('puppeteer-extra')
 *
 * // ts/es6 import
 * import { addExtra } from 'puppeteer-extra'
 *
 * // Patch e.g. puppeteer-firefox and add plugins
 * const puppeteer = addExtra(require('puppeteer-firefox'))
 * puppeteer.use(...)
 *
 * @param puppeteer Any puppeteer API-compatible puppeteer implementation or version.
 * @return A fresh PuppeteerExtra instance using the provided puppeteer
 */
export declare const addExtra: (puppeteer: VanillaPuppeteer) => PuppeteerExtra;
