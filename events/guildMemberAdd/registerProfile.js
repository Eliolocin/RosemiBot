const profileModel = require("../../models/profileSchema.js");

module.exports = async (client, member) => {
  let profile = await profileModel.create({
    userID: member.id,
    serverID: member.guild.id,
  });
  profile.save();
};
