import UserModel from "../models/userSchema";

async function convertMentionsToNicknames(
  text: string,
  serverID: string
): Promise<string> {
  try {
    // Find all mentions in the text using regex
    const mentionRegex = /<@!?(\d+)>/g;
    let matches = [...text.matchAll(mentionRegex)];
    let convertedText = text;

    // Process each mention
    for (const match of matches) {
      const userID = match[1];
      const fullMention = match[0];

      // Find user in database
      const userData = await UserModel.findOne({ userID, serverID });

      if (userData && userData.nickname) {
        // Replace mention with nickname, preserving ML tags
        convertedText = convertedText.replace(
          new RegExp(fullMention, 'g'), // Use global flag to replace all instances
          userData.nickname
        );
      }
    }

    return convertedText;
  } catch (error) {
    console.error("Error in convertMentionsToNicknames:", error);
    return text;
  }
}

export { convertMentionsToNicknames };
