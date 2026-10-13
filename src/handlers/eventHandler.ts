import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Client, RateLimitData } from "discord.js";
import type { EventArg, EventFunction } from "../types/discord/global";
import { log } from "../utils/misc/logger";
import { healthTracker } from "../utils/misc/healthTracker";

type Handler = {
  file: string;
  execute: EventFunction;
};

type EventModule = {
  default?: unknown;
};

function isEventFunction(value: unknown): value is EventFunction {
  return typeof value === "function";
}

const eventFolderMap: Record<string, string> = {
  guildCreate: "guildCreate",
  guildMemberAdd: "guildMemberAdd",
  guildMemberUpdate: "guildMemberUpdate",
  guildMemberRemove: "guildMemberRemove",
  interactionCreate: "interactionCreate",
  messageCreate: "messageCreate",
  messageDelete: "messageDelete",
  clientReady: "clientReady",
  emojiCreate: "guildEmojisUpdate",
  emojiDelete: "guildEmojisUpdate",
  emojiUpdate: "guildEmojisUpdate",
  stickerCreate: "guildStickersUpdate",
  stickerDelete: "guildStickersUpdate",
  stickerUpdate: "guildStickersUpdate",
};

/**
 * REST rate limits arrive on `client.rest`, not on the client.
 *
 * discord.js v14 keeps the limiter in the REST instance, so a `rateLimit` listener on the client
 * never fires and the handler folder would be dead weight.
 */
const REST_RATE_LIMIT_FOLDER = "rateLimit";

async function getExistingEventFolders(eventsBasePath: string): Promise<Set<string>> {
  const existingFolders = new Set<string>();
  const glob = new Bun.Glob("*/");

  for await (const folder of glob.scan({ cwd: eventsBasePath, onlyFiles: false })) {
    const folderName = folder.replace(/[\\/]+$/, "");
    if (folderName && !folderName.startsWith(".")) {
      existingFolders.add(folderName);
    }
  }

  return existingFolders;
}

async function getHandlerFiles(handlerFolderPath: string): Promise<string[]> {
  const glob = new Bun.Glob("*.ts");
  const handlerFiles: string[] = [];

  // Shallow-only by contract: subfolder files under src/events/<eventName>/ are helpers, not event handlers.
  for await (const fileName of glob.scan({ cwd: handlerFolderPath, onlyFiles: true })) {
    if (!fileName.startsWith(".")) {
      handlerFiles.push(path.join(handlerFolderPath, fileName));
    }
  }

  return handlerFiles.sort((a, b) => a.localeCompare(b));
}

async function loadHandlersForEvent(
  eventName: string,
  handlerFolderName: string,
  handlerFolderPath: string,
): Promise<Handler[]> {
  const eventFiles = await getHandlerFiles(handlerFolderPath);
  const handlers: Handler[] = [];

  for (const eventFile of eventFiles) {
    try {
      const eventModule = (await import(pathToFileURL(eventFile).href)) as EventModule;
      const eventFunction = eventModule.default;

      if (isEventFunction(eventFunction)) {
        handlers.push({ file: eventFile, execute: eventFunction });
      } else {
        log.warn(`Default export in ${eventFile} is not a function.`);
      }
    } catch (importError) {
      log.error(`Failed to import event file: ${eventFile} for event ${eventName}`, importError, {
        errorType: "EventHandlerImportError",
        metadata: { eventName, eventFile, handlerFolderName },
      });
    }
  }

  return handlers;
}

async function loadEventHandlerMap(eventsBasePath: string): Promise<Map<string, Handler[]>> {
  const handlerMap = new Map<string, Handler[]>();
  const existingFolders = await getExistingEventFolders(eventsBasePath);
  const uniqueHandlerFolders = [...new Set(Object.values(eventFolderMap))];

  for (const folderName of uniqueHandlerFolders) {
    if (!existingFolders.has(folderName)) {
      log.warn(`Handler folder not found, skipping: ${folderName}`);
    }
  }

  for (const [eventName, handlerFolderName] of Object.entries(eventFolderMap)) {
    if (!existingFolders.has(handlerFolderName)) {
      continue;
    }

    const handlerFolderPath = path.join(eventsBasePath, handlerFolderName);
    const handlers = await loadHandlersForEvent(eventName, handlerFolderName, handlerFolderPath);

    if (handlers.length > 0) {
      handlerMap.set(eventName, handlers);
    }
  }

  return handlerMap;
}

/**
 * Sets up all event listeners for the Discord client after loading event modules.
 * Maps specific Discord events to handler folders.
 */
const setupEventListeners = async (client: Client): Promise<void> => {
  log.section("Starting Event Listeners Setup...");
  const eventsBasePath = path.join(__dirname, "..", "events");
  const handlerMap = await loadEventHandlerMap(eventsBasePath);

  // One failed handler must not hide the handlers behind it, for REST rate limits the same as for
  // gateway events.
  const runHandlers = async (eventName: string, handlers: Handler[], args: EventArg[]): Promise<void> => {
    for (const handler of handlers) {
      try {
        await handler.execute(client, ...args);
      } catch (error) {
        log.error(`Failed to execute event file: ${handler.file} for event ${eventName}`, error, {
          errorType: "EventHandlerError",
          metadata: { eventName, eventFile: handler.file },
        });
      }
    }
  };

  for (const [eventName, handlerFolderName] of Object.entries(eventFolderMap)) {
    const handlers = handlerMap.get(eventName);

    if (!handlers) {
      continue;
    }

    client.on(eventName, async (...args: EventArg[]) => {
      healthTracker.recordActivity();
      await runHandlers(eventName, handlers, args);
    });
    log.success(`Mapped "${eventName}" listener to "${handlerFolderName}" handlers`);
  }

  const existingFolders = await getExistingEventFolders(eventsBasePath);
  if (existingFolders.has(REST_RATE_LIMIT_FOLDER)) {
    const rateLimitHandlers = await loadHandlersForEvent(
      "rateLimited",
      REST_RATE_LIMIT_FOLDER,
      path.join(eventsBasePath, REST_RATE_LIMIT_FOLDER),
    );

    if (rateLimitHandlers.length > 0) {
      client.rest.on("rateLimited", (rateLimitData: RateLimitData) => {
        void runHandlers("rateLimited", rateLimitHandlers, [rateLimitData]);
      });
      log.success(`Mapped "rateLimited" listener to "${REST_RATE_LIMIT_FOLDER}" handlers`);
    }
  }

  log.section("Event Listeners Setup Complete.");
};

export default setupEventListeners;
