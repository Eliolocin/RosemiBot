const profileModel = require("../../models/profileSchema.js");

// Function that gives
module.exports = async (client, message) => {
  if (message.author.bot) return;

  let profile;
  try {
    profile = await profileModel.findOne({ userID: message.author.id });
    if (!profile) {
      let profile = await profileModel.create({
        userID: message.author.id,
        serverID: message.guild.id,
      });
      profile.save();
    }
  } catch (err) {
    console.log(err);
  }
};
