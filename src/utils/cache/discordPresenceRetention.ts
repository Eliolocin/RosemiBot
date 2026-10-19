// The index retains successful guild-user pairs for this process, so add expiry if its size approaches the memory saved by filtering presences.
export class DiscordPresenceRetention {
  private readonly participants = new Set<string>();

  retain(serverDiscId: string, userDiscId: string): void {
    this.participants.add(`${serverDiscId}:${userDiscId}`);
  }

  has(serverDiscId: string, userDiscId: string): boolean {
    return this.participants.has(`${serverDiscId}:${userDiscId}`);
  }
}

export const discordPresenceRetention = new DiscordPresenceRetention();
