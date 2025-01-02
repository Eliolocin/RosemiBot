const { testServer } = process.env.JACKO_ID;
const getLocalCommands = require("../../utils/getLocalCommands");
const userModel = require("../../models/userSchema.js");

module.exports = async (client, interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const localCommands = getLocalCommands();
  const TIMEOUT_DURATION = 30000; // 30 seconds timeout
  const cooldownDurations = new Map([
    ["economy", 2000], // 2 seconds
    ["scrape", 10000], // 10 seconds
    ["tool", 10000], // 10 seconds
    ["fun", 5000], // 5 seconds
    // Add other categories and durations as needed
  ]);

  try {
    const commandObject = localCommands.find(
      (cmd) => cmd.name === interaction.commandName
    );

    if (!commandObject) return;

    // Timeout Logic
    const timeoutPromise = new Promise((resolve, reject) => {
      setTimeout(() => {
        reject(
          "Command timed out. User took too long to complete the interaction."
        ); // Timeout rejection
      }, TIMEOUT_DURATION);
    });

    // Main Command Logic
    const mainLogicPromise = async () => {
      if (commandObject.devOnly) {
        if (interaction.member.id != process.env.DEV_ID) {
          await interaction.reply({
            content: "Sorry, only developers are allowed to run this command!",
            ephemeral: true,
          });
          return;
        }
      }

      if (commandObject.testOnly) {
        if (!(interaction.guild.id === testServer)) {
          await interaction.reply({
            content: "Sorry, this is a test command!",
            ephemeral: true,
          });
          return;
        }
      }

      if (commandObject.permissionsRequired?.length) {
        for (const permission of commandObject.permissionsRequired) {
          if (!interaction.member.permissions.has(permission)) {
            await interaction.reply({
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
            await interaction.reply({
              content: "I don't have enough permissions!",
              ephemeral: true,
            });
            return;
          }
        }
      }

      let user;
      try {
        user = await userModel.findOne({ userID: interaction.member.id });
        if (!user) {
          const serverLocale = interaction.guild.preferredLocale;
          const userLanguage = serverLocale.startsWith("ja") ? "ja" : "en";

          // Create a new user
          user = await userModel.create({
            userID: interaction.member.id,
            serverID: interaction.guild.id,
            nickname: interaction.member.displayName, // Add username as initial nickname
            language: userLanguage,
          });
          await user.save();
        }

        // Cooldown Logic
        const category = commandObject.category; // Assume each command has a 'category' like "economy"
        const cooldownDuration = cooldownDurations.get(category); // Get category cooldown duration

        if (cooldownDuration) {
          const now = Date.now();
          const userCooldowns = user.cooldowns || {}; // Fallback to avoid undefined

          if (userCooldowns[category] && userCooldowns[category] > now) {
            const remaining = Math.ceil((userCooldowns[category] - now) / 1000); // Remaining seconds
            await interaction.reply({
              content: `⏳ You need to wait ${remaining} seconds before using this command again.`,
              ephemeral: true,
            });
            return;
          }

          // Set/update user's cooldown for the category
          userCooldowns[category] = now + cooldownDuration;
          user.cooldowns = userCooldowns;
          await user.save();
        }

        // Execute the command callback
        await commandObject.callback(client, interaction, user);
      } catch (err) {
        console.error("Error handling user creation or cooldowns:", err);
      }
    };

    // Run both promises, enforce timeout
    await Promise.race([mainLogicPromise(), timeoutPromise]);
  } catch (error) {
    // Handle timeouts or general errors
    if (
      error ===
      "Command timed out. User took too long to complete the interaction."
    ) {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content:
            "You took too long to respond! Please try again later when you're ready.",
          ephemeral: true,
        });
      }
    } else {
      console.error(`(─‿‿─) There was an error running a command: ${error}`);
    }
  }
};
