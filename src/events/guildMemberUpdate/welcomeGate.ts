import type { Client, GuildMember } from "discord.js";
import { notifyWelcomeGateMemberUpdate } from "@/events/guildMemberAdd/helpers/welcomeGate";

/**
 * Lets a pending welcome greeting proceed once Discord reports the member cleared screening or onboarding.
 * @param _oldMember - Unused: sweeping guild members from cache makes the old state unreliable
 * @param newMember - The member after the update
 */
const handler = async (_client: Client, _oldMember: GuildMember, newMember: GuildMember): Promise<void> => {
  notifyWelcomeGateMemberUpdate(newMember);
};

export default handler;
