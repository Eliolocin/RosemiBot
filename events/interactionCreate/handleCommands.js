const { testServer } = process.env.JACKO_ID;
const getLocalCommands = require("../../utils/getLocalCommands");
const profileModel = require("../../models/profileSchema.js");

module.exports = async (client, interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const localCommands = getLocalCommands();

  try {
    const commandObject = localCommands.find(
      (cmd) => cmd.name === interaction.commandName,
    );

    if (!commandObject) return;

    if (commandObject.devOnly) {
      //if(!devs.includes(interaction.member.id)){
      if (interaction.member.id != process.env.DEV_ID) {
        interaction.reply({
          content: "Sorry, only developers are allowed to run this command!",
          ephemeral: true,
        });
        return;
      }
    }

    if (commandObject.testOnly) {
      if (!(interaction.guild.id === testServer)) {
        interaction.reply({
          content: "Sorry, this is a test command!",
          ephemeral: true,
        });
        return;
      }
    }

    if (commandObject.permissionsRequired?.length) {
      for (const permission of commandObject.permissionsRequired) {
        if (!interaction.member.permissions.has(permission)) {
          interaction.reply({
            content: "Not enough permissions!",
            ephemeral: true,
          });
          return;
        }
      }
    }

    if (commandObject.botPermissions?.length) {
      for (const permission of commandObject.botPermissions) {
        const bot = interaction.guild.members.me;

        if (!bot.permissions.has(permission)) {
          interaction.reply({
            content: "I don't have enough permissions!",
            ephemeral: true,
          });
          return;
        }
      }
    }

    let profile;
    try {
      // Step 1: Determine the server's language from preferredLocale
      const serverLocale = interaction.guild.preferredLocale;
      console.log(`Server language detected: ${serverLocale}`);

      // Default to "en" unless the locale indicates Japanese
      const userLanguage = serverLocale.startsWith("ja") ? "ja" : "en";

      // Step 2: Check if the profile exists for the user
      profile = await profileModel.findOne({ userID: interaction.member.id });
      if (!profile) {
        // Create a new profile with the detected language
        profile = await profileModel.create({
          userID: interaction.member.id,
          serverID: interaction.guild.id,
          language: userLanguage, // Set language based on server locale
        });
        await profile.save();
        console.log(`Profile created with language set to ${userLanguage}`);
      }
    } catch (err) {
      console.error("Error handling profile creation:", err);
    }

    await commandObject.callback(client, interaction, profile);
  } catch (error) {
    console.log(`(─‿‿─) There was an error running a command: ${error}`);
  }
};
