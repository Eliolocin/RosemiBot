/**
 * Fake interaction for route and route-dispatch tests.
 *
 * Route suites each grew their own factory with the same surface: a component interaction whose
 * `deferUpdate`/`editReply` a test observes, parameterized by kind, workspace, manager rights, modal
 * field values, and select values. They differed only in which array they recorded into, so this
 * factory returns the recording arrays and accepts the rest as options.
 *
 * The returned object is cast at the call site (`as unknown as ChatInputCommandInteraction`) because
 * discord.js models a class whose constructor is not worth driving here; the type below is the
 * contract the routes actually read.
 */

import type { FakeCall } from "./fakeInteraction";
import { Collection, type Attachment } from "discord.js";

/** Which component kind the route should think it received. */
type RouteInteractionKind = "button" | "string-select" | "channel-select" | "modal";

/** One method call the fake recorded, widened with the payload the caller passed. */
interface RouteInteractionCall extends FakeCall {
  /** First argument of the call, when the caller passed one. */
  payload?: unknown;
}

/** Fields the fake guild cache reports for a channel; these routes read only these two. */
export interface RouteGuildChannel {
  name: string;
  type: number;
}

/** Fields a raw modal submit reports; `fields.has` answers presence, not emptiness. */
interface RouteModalFields {
  fields: Map<string, boolean>;
  getTextInputValue: (fieldId: string) => string;
}

/**
 * The interaction surface the config and personal routes read. Every assertion a route suite makes
 * (`deferred`, `replied`, `edits`, select `values`, modal `fields`) is observable here.
 */
export interface RouteInteraction {
  id: string;
  customId: string;
  user: { id: string; username: string; displayName: string; globalName: string; displayAvatarURL?: () => string };
  channelId: string;
  channel: { id: string; name: string; type: number; isThread: () => boolean; send: () => Promise<unknown> };
  guildId: string | null;
  guild: {
    id: string;
    name: string;
    channels: { fetch: (id: string) => Promise<unknown>; cache: Map<string, unknown> };
    members: { me: unknown; fetch: (id: string) => Promise<unknown> };
  } | null;
  client: { user: unknown };
  memberPermissions: { has: (flag: unknown) => boolean };
  values: string[];
  attachmentSizeLimit: number;
  message: { attachments: Collection<string, Pick<Attachment, "id" | "name" | "size">> };
  fields: RouteModalFields;
  deferred: boolean;
  replied: boolean;
  /** Payloads passed to `editReply`, in call order. */
  edits: unknown[];
  /** Payloads passed to `reply` and `followUp`, in call order. */
  replies: unknown[];
  /** Every recorded call in order, for assertions on acknowledgement sequencing. */
  calls: RouteInteractionCall[];
  isButton: () => boolean;
  isStringSelectMenu: () => boolean;
  isChannelSelectMenu: () => boolean;
  isModalSubmit: () => boolean;
  isChatInputCommand: () => boolean;
  deferReply: (payload?: unknown) => Promise<void>;
  deferUpdate: (payload?: unknown) => Promise<void>;
  reply: (payload?: unknown) => Promise<unknown>;
  editReply: (payload?: unknown) => Promise<unknown>;
  followUp: (payload?: unknown) => Promise<unknown>;
  showModal: (payload?: unknown) => Promise<void>;
  update: (payload?: unknown) => Promise<unknown>;
  fetchReply: () => Promise<{ id: string; createdTimestamp: number }>;
  webhook: { send: (payload?: unknown) => Promise<unknown> };
}

/** Options accepted by {@link createRouteInteraction}. */
export interface RouteInteractionOptions {
  /** Route custom ID the dispatcher parses. Defaults to a plain button ID. */
  customId?: string;
  kind?: RouteInteractionKind;
  /** `null` models a DM workspace; the default is a guild workspace. */
  guildId?: string | null;
  /**
   * Defaults to true. `ManageGuild` is the only permission the fake can grant: every other flag is
   * denied either way, so a route that checks a second permission needs its own fake.
   */
  isManager?: boolean;
  /** Select values the route reads off `interaction.values`. */
  values?: string[];
  attachmentSizeLimit?: number;
  messageAttachments?: ReadonlyArray<Pick<Attachment, "id" | "name" | "size">>;
  onEditReply?: (payload: unknown) => Promise<unknown>;
  /** Raw modal field values keyed by field ID. */
  fields?: Record<string, string>;
  /** Overrides `guild.channels.fetch`, for routes that resolve channels by ID. */
  fetch?: (channelId: string) => Promise<unknown>;
  /**
   * Channels the guild cache holds, keyed by channel ID. Routes that resolve a selected channel
   * (`guild.channels.cache.get`) reject anything else, so a suite testing a confirmed channel
   * declares it here rather than replacing the whole guild object.
   */
  channelCache?: ReadonlyMap<string, RouteGuildChannel>;
  /** Identity fields a suite needs to distinguish; any other key is rejected. */
  overrides?: Partial<Pick<RouteInteraction, "id" | "user">>;
}

const IDENTITY_OVERRIDE_KEYS = new Set(["id", "user"]);

// Destructuring drops a key it does not name, and a spread-built options object escapes the
// excess-property check, so a misplaced `user:` at the top level would otherwise run the route as the
// default actor unnoticed.
const OPTION_KEYS = new Set<string>([
  "customId",
  "kind",
  "guildId",
  "isManager",
  "values",
  "attachmentSizeLimit",
  "messageAttachments",
  "onEditReply",
  "fields",
  "fetch",
  "channelCache",
  "overrides",
] satisfies (keyof RouteInteractionOptions)[]);

/** Channel type 0 is `ChannelType.GuildText`, the only kind these routes accept. */
const GUILD_TEXT = 0;

/**
 * `PermissionsBitField.Flags.ManageGuild`, as the bigint discord.js resolves and as the bare string
 * name some routes compare against instead. Both spellings mean the same permission to production.
 */
const MANAGE_GUILD_FLAG = 32n;
const MANAGE_GUILD_NAME = "ManageGuild";

/**
 * Builds a fake interaction for one route dispatch.
 *
 * `deferUpdate` and `deferReply` mark the interaction deferred, and `reply` marks it replied, so a
 * suite can assert acknowledgement ordering without inspecting the call list.
 */
export function createRouteInteraction(options: RouteInteractionOptions = {}): RouteInteraction {
  for (const key of Object.keys(options)) {
    if (!OPTION_KEYS.has(key)) {
      const hint = IDENTITY_OVERRIDE_KEYS.has(key) ? ` Pass it as overrides: { ${key} }.` : "";
      throw new Error(`createRouteInteraction: unknown option "${key}".${hint}`);
    }
  }

  const {
    customId = "config:v2:test-action:en-US",
    kind = "button",
    guildId = "guild-1",
    isManager = true,
    values = [],
    attachmentSizeLimit = 10 * 1024 * 1024,
    messageAttachments = [],
    onEditReply,
    fields = {},
    fetch,
    channelCache,
    overrides = {},
  } = options;

  for (const key of Object.keys(overrides)) {
    if (!IDENTITY_OVERRIDE_KEYS.has(key)) {
      throw new Error(
        `createRouteInteraction: unknown override "${key}". Add it as an option so the factory keeps recording the behavior it drives.`,
      );
    }
  }

  const calls: RouteInteractionCall[] = [];
  const edits: unknown[] = [];
  const replies: unknown[] = [];
  // A modal submit reports field presence, so the map holds the declared field IDs rather than values.
  const modalFields = new Map(Object.keys(fields).map((fieldId) => [fieldId, true]));

  const inGuild = guildId !== null;

  // `channels.fetch` answers the same rows the cache holds, so a route that resolves a channel
  // either way sees one consistent guild rather than two fixtures that can disagree.
  const channelCacheStore = new Map<string, unknown>(channelCache ?? []);
  const fetchChannel =
    fetch ??
    (async (channelId: string) =>
      channelCacheStore.has(channelId)
        ? { id: channelId, ...(channelCacheStore.get(channelId) as RouteGuildChannel) }
        : undefined);

  const interaction: RouteInteraction = {
    id: "interaction-1",
    customId,
    user: {
      id: "user-1",
      username: "Mirri",
      displayName: "Mirri",
      globalName: "Mirri",
      displayAvatarURL: () => "https://cdn.example.invalid/avatar.png",
    },
    channelId: "channel-1",
    channel: {
      id: "channel-1",
      name: "lounge",
      type: GUILD_TEXT,
      isThread: () => false,
      send: async () => undefined,
    },
    guildId,
    guild: inGuild
      ? {
          id: guildId,
          name: "Juno Lounge",
          channels: {
            fetch: fetchChannel,
            cache: channelCacheStore,
          },
          members: { me: null, fetch: async () => null },
        }
      : null,
    client: { user: null },
    memberPermissions: {
      has: (flag: unknown) => isManager && (flag === MANAGE_GUILD_FLAG || flag === MANAGE_GUILD_NAME),
    },
    values,
    attachmentSizeLimit,
    message: { attachments: new Collection(messageAttachments.map((attachment) => [attachment.id, attachment])) },
    fields: {
      fields: modalFields,
      getTextInputValue: (fieldId: string) => fields[fieldId] ?? "",
    },
    deferred: false,
    replied: false,
    edits,
    replies,
    calls,

    isButton: () => kind === "button",
    isStringSelectMenu: () => kind === "string-select",
    isChannelSelectMenu: () => kind === "channel-select",
    isModalSubmit: () => kind === "modal",
    isChatInputCommand: () => false,

    deferReply: async (payload?: unknown) => {
      calls.push({ method: "deferReply", args: [payload], payload });
      interaction.deferred = true;
    },
    deferUpdate: async (payload?: unknown) => {
      calls.push({ method: "deferUpdate", args: [payload], payload });
      interaction.deferred = true;
    },
    reply: async (payload?: unknown) => {
      calls.push({ method: "reply", args: [payload], payload });
      // Mirrors discord.js InteractionAlreadyReplied, which a permissive fake let ship once.
      if (interaction.deferred || interaction.replied) {
        throw new Error("The reply to this interaction has already been sent or deferred.");
      }
      replies.push(payload);
      interaction.replied = true;
      return payload;
    },
    editReply: async (payload?: unknown) => {
      calls.push({ method: "editReply", args: [payload], payload });
      edits.push(payload);
      if (onEditReply) return onEditReply(payload);
      return payload;
    },
    followUp: async (payload?: unknown) => {
      calls.push({ method: "followUp", args: [payload], payload });
      replies.push(payload);
      return payload;
    },
    showModal: async (payload?: unknown) => {
      calls.push({ method: "showModal", args: [payload], payload });
    },
    update: async (payload?: unknown) => {
      calls.push({ method: "update", args: [payload], payload });
      return payload;
    },
    fetchReply: async () => ({ id: "fake_reply_id", createdTimestamp: Date.now() }),
    webhook: {
      send: async (payload?: unknown) => {
        calls.push({ method: "webhook.send", args: [payload], payload });
        return undefined;
      },
    },
  };

  Object.assign(interaction, overrides);

  return interaction;
}

/**
 * Keeps every interaction a harness builds and exposes their recordings in dispatch order, because
 * several tests dispatch more than once and then read the whole recording.
 */
export function createInteractionRecorder() {
  const recorded: RouteInteraction[] = [];
  return {
    get edits(): unknown[] {
      return recorded.flatMap((interaction) => interaction.edits);
    },
    get replies(): unknown[] {
      return recorded.flatMap((interaction) => interaction.replies);
    },
    get calls(): RouteInteraction["calls"] {
      return recorded.flatMap((interaction) => interaction.calls);
    },
    record(interaction: RouteInteraction): void {
      recorded.push(interaction);
    },
  };
}
