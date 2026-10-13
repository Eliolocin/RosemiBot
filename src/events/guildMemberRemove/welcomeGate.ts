import type { Client, GuildMember, PartialGuildMember } from "discord.js";
import { notifyWelcomeGateMemberRemove } from "@/events/guildMemberAdd/helpers/welcomeGate";

/**
 * Cancels a pending welcome greeting when its member leaves before finishing onboarding.
 * @param member - The departing member; may be partial when uncached, which is enough because only IDs are read
 */
const handler = async (_client: Client, member: GuildMember | PartialGuildMember): Promise<void> => {
  notifyWelcomeGateMemberRemove(member.guild.id, member.id);
};

export default handler;
