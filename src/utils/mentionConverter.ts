import UserModel from "../models/userSchema";

// Method 1: Use export statement at declaration
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
        // Replace mention with nickname
        convertedText = convertedText.replace(
          fullMention,
          `@${userData.nickname}`
        );
      } else {
        // If no nickname found, just use original <@123456789> format
        convertedText = convertedText.replace(fullMention, `<@${userID}>`);
      }
    }

    return convertedText;
  } catch (error) {
    console.error("Error in convertMentionsToNicknames:", error);
    return text; // Return original text if there's an error
  }
}

// OR Method 2: Use export statement at the bottom
// async function convertMentionsToNicknames(text: string): Promise<string> {
//   // ...existing code...
// }
export { convertMentionsToNicknames };
