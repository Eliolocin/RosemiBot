/**
 * Minimal fake ChatInputCommandInteraction for interaction timing tests.
 *
 * Records every acknowledgement-related call (reply, deferReply, showModal,
 * editReply, followUp, deferUpdate, update) so tests can assert exact call
 * order without connecting to Discord.
 */

/** One recorded call to the fake interaction object. */
export type FakeCall = {
  /** Name of the interaction method that was invoked. */
  method: string;
  /** Arguments passed to the method. */
  args: unknown[];
};

/**
 * Covers every acknowledgement method the Discord command-system docs require plus the helpers
 * commands call directly.
 */
export type FakeInteraction = {
  /** Tracks whether deferReply() has been called. */
  deferred: boolean;
  /** Tracks whether reply() or showModal() has been called. */
  replied: boolean;
  id: string;
  createdTimestamp: number;
  guild: object | null;
  channel: object | null;
  channelId: string;
  guildId: string | null;
  user: {
    id: string;
    displayName: string;
    globalName: string;
    username: string;
    displayAvatarURL: (_opts?: unknown) => string;
  };
  member: {
    displayAvatarURL: (_opts?: unknown) => string;
  } | null;
  memberPermissions: { has: (_flag: unknown) => boolean } | null;
  options: {
    getString: (_name: string, _required?: boolean) => string | null;
    getInteger?: (_name: string) => number | null;
    getBoolean: (_name: string) => boolean | null;
  };
  webhook: { send: (..._args: unknown[]) => Promise<void> };
  reply: (..._args: unknown[]) => Promise<void>;
  deferReply: (..._args: unknown[]) => Promise<void>;
  showModal: (..._args: unknown[]) => Promise<void>;
  editReply: (..._args: unknown[]) => Promise<void>;
  followUp: (..._args: unknown[]) => Promise<void>;
  deferUpdate: (..._args: unknown[]) => Promise<void>;
  update: (..._args: unknown[]) => Promise<void>;
  fetchReply: () => Promise<{ id: string; createdTimestamp: number }>;
};

/**
 * Creates a minimal fake interaction that records every acknowledgement-related
 * call. The `calls` array grows in call order so tests can assert exact
 * sequences with `calls.map(c => c.method)`.
 *
 * @param overrides - Partial FakeInteraction values merged after default setup.
 *                    Use this to supply guild, channel, options, etc.
 */
export function makeFakeInteraction(overrides: Partial<FakeInteraction> = {}): {
  interaction: FakeInteraction;
  calls: FakeCall[];
} {
  const calls: FakeCall[] = [];

  // Defined as a plain object so method bodies can close over `interaction` to
  // update `deferred`/`replied` flags synchronously before any awaiter resumes.
  const interaction: FakeInteraction = {
    deferred: false,
    replied: false,
    id: "fake_interaction_id",
    createdTimestamp: Date.now() - 50,

    guild: null,
    channel: null,
    channelId: "fake_channel_id",
    guildId: null,
    user: {
      id: "fake_user_id",
      displayName: "TestUser",
      globalName: "TestUser",
      username: "testuser",
      displayAvatarURL: () => "https://cdn.example.com/avatar.png",
    },
    member: null,
    memberPermissions: null,
    options: {
      getString: () => null,
      getInteger: () => null,
      getBoolean: () => null,
    },
    webhook: {
      send: async (...args: unknown[]) => {
        calls.push({ method: "webhook.send", args });
      },
    },

    // reply: sets replied=true so subsequent calls route to editReply
    reply: async (...args: unknown[]) => {
      calls.push({ method: "reply", args });
      interaction.replied = true;
    },

    // deferReply: sets deferred=true; represents the initial deferred ack
    deferReply: async (...args: unknown[]) => {
      calls.push({ method: "deferReply", args });
      interaction.deferred = true;
    },

    // showModal: the acknowledgement path for modal commands; does NOT set
    //    replied=true in Discord.js, but the interaction IS consumed.
    showModal: async (...args: unknown[]) => {
      calls.push({ method: "showModal", args });
    },

    // editReply: only valid after deferReply() or reply()
    editReply: async (...args: unknown[]) => {
      calls.push({ method: "editReply", args });
    },

    // followUp: only valid after any acknowledgement
    followUp: async (...args: unknown[]) => {
      calls.push({ method: "followUp", args });
    },

    deferUpdate: async (...args: unknown[]) => {
      calls.push({ method: "deferUpdate", args });
    },

    update: async (...args: unknown[]) => {
      calls.push({ method: "update", args });
    },

    // fetchReply: not an acknowledgement; returns a fake message so ping-style
    // commands that measure latency don't throw.
    fetchReply: async () => ({
      id: "fake_reply_id",
      createdTimestamp: Date.now(),
    }),
  };

  // Apply caller-supplied overrides after all defaults are set so partial
  // objects (e.g. only guild) merge cleanly without breaking method closures.
  Object.assign(interaction, overrides);

  return { interaction, calls };
}

/**
 * Convenience helper: extract just the method names from a calls array.
 * Useful for `expect(callMethods(calls)).toEqual(["deferReply", "editReply"])`.
 */
export function callMethods(calls: FakeCall[]): string[] {
  return calls.map((call) => call.method);
}
