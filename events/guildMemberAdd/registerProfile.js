const userModel = require("../../models/userSchema.js");

module.exports = async (client, member) => {
  let user;
  try {
    // Step 1: Determine the server's language from preferredLocale
    const serverLocale = member.guild.preferredLocale;
    console.log(`Server language detected: ${serverLocale}`);

    // Default to "en" unless the locale indicates Japanese
    const userLanguage = serverLocale.startsWith("ja") ? "ja" : "en";

    // Step 2: Check if the user exists for the user
    user = await userModel.findOne({ userID: member.id });
    if (!user) {
      // Create a new user with the detected language
      user = await userModel.create({
        userID: member.id,
        serverID: member.guild.id,
        nickname: member.displayName, // Add username as initial nickname
        language: userLanguage, // Set language based on server locale
      });
      await user.save();
      console.log(`User created with language set to ${userLanguage}`);
    }
  } catch (err) {
    console.error("Error handling user creation:", err);
  }
};
