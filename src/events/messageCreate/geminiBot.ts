// geminiBot.ts
import { Client, Message, TextChannel } from "discord.js";
import { config } from "dotenv";
import fs from "fs";
import BotModel from "../../models/botSchema"; // Adjust import path if needed
import UserModel from "../../models/userSchema";
import {
  GoogleGenerativeAI,
  HarmBlockThreshold,
  HarmCategory,
} from "@google/generative-ai";
import { IBot, IUser } from "../../types"; // Adjust if you have a separate IBot interface file
import { convertMentionsToNicknames } from "../../utils/mentionConverter";

config(); // Ensure .env is loaded

const memoryLimit = 80; // Number of messages retained
const gachaTrigger = 50; // Number of messages until bot talks by itself
const safetySettings = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
];
const googleModel = "gemini-1.5-pro-latest"; // Google model to use

// Main exported function
export default async function geminiBot(
  client: Client,
  message: Message
): Promise<void> {
  if (!(message.channel instanceof TextChannel)) return;
  if (!message.channel.permissionsFor(client.user!)?.has("SendMessages"))
    return;

  try {
    // Retrieve bot data from DB
    // Note: Adjust how you identify the serverID if needed, for example: message.guild?.id
    const botData: IBot | null = await BotModel.findOne({
      serverID: message.guild?.id,
    });
    const userData: IUser | null = await UserModel.findOne({
      userID: message.author?.id,
      serverID: message.guild?.id,
    });

    // Safety check if no botData found; you may choose to create a default DB entry here
    if (!botData || !userData) return;

    // Gacha system, using counters[0]
    let gachaActive = true;
    let newCount = -1;

    if (gachaActive && !message.author.bot) {
      if (message.channel.id === process.env.GENERAL_ID) {
        newCount = botData.counters[0] ?? 0; // read existing count
        if (newCount === gachaTrigger) {
          newCount = 0;
        }
        botData.counters[0] = newCount + 1;
        await botData.save();
      }
    }

    // Check if the message is a reply
    let referenceMessage: Message | undefined;
    if (message.reference?.messageId) {
      referenceMessage = message.channel.messages.cache.get(
        message.reference.messageId
      );
    }

    // Build triggers condition from the DB triggers array
    const triggersActive = botData.triggers.some((trigger) =>
      message.content.toLowerCase().includes(trigger.toLowerCase())
    );

    // Condition to see if the newCount condition is met
    const isGachaHit = (botData.counters[0] ?? 0) % gachaTrigger === 0;

    // Combined condition to see if we fire the Bot's generation
    if (
      ((referenceMessage?.author.bot || triggersActive) &&
        message.channel.id !== process.env.COMMANDS_ID &&
        !message.author.bot &&
        !message.content.startsWith("!") &&
        !message.content.startsWith(":") &&
        message.channel.isTextBased()) ||
      (isGachaHit && message.channel.id === process.env.GENERAL_ID)
    ) {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_KEY as string);

      const model = genAI.getGenerativeModel({
        model: googleModel,
        safetySettings,
      });

      await message.channel.sendTyping();

      const currentTime = getCurrentTime();
      const channelName = message.channel.name;
      let user = message.author.username;
      if (!initialIsCapital(user)) {
        user = capitalizeFirstLetter(user);
      }

      // Prepare the context as in the original code
      let context = `[Genre: Comedy; Tags: chatroom, slice of life, internet culture, anime, manga; Scenario: The current date and time is ${currentTime}. ${botData.botName}, the virtual secretary created her Papa in the image of the VTuber named Rosemi Lovelock, is currently lurking around the Jack-Oᶠᶠ Discord server, specifically at the text channel named "${channelName}", chatting with server members there while upholding her duty as the Discord server's secretary by assisting them with any question or problem they might have albeit serious, personal, or just plain silly. Even if the Discord server has NO rules at all (as mandated by her Papa) she still strives to keep order in the server to the best of our power since having no rules causes chaos.]\n`;

      const sysStart = `<|im_start|>system\n`;
      const userStart = `<|im_start|>user\n`;
      const botStart = `<|im_start|>assistant\n`;
      const mlEnd = `<|im_end|>\n`;

      // Build the injection
      let injection = sysStart + context;

      // 1) Add the DB's botDatabase
      //    You might want to join them in a single string or handle them differently
      if (botData.botDatabase && botData.botDatabase.length > 0) {
        injection +=
          botData.botDatabase.map((item) => `[${item}]`).join("\n") + "\n";
      }

      injection += mlEnd;

      // 2) Add conversationExamples
      //    We'll transform them into the same <|im_start|> user/assistant format if desired
      if (
        botData.conversationExamples &&
        botData.conversationExamples.length > 0
      ) {
        botData.conversationExamples.forEach((example) => {
          const userInput = example.input
            .replace("{user}", userData.nickname)
            .replace("{bot}", botData.botName);
          const botOutput = example.output
            .replace("{bot}", botData.botName)
            .replace("{user}", userData.nickname);
          injection +=
            `${userStart}${userData.nickname}: ${userInput}\n${mlEnd}` +
            `${botStart}${botData.botName}: ${botOutput}\n${mlEnd}`;
        });
      }

      // 3) Then add recent conversation history
      // Reverse fetch
      const prevMessages = await message.channel.messages.fetch({
        limit: memoryLimit,
      });
      const reversed = [...prevMessages.values()].reverse();
      let chatInput = injection;

      reversed.forEach((msg) => {
        // Skip certain messages
        if (
          msg.content.startsWith("!") ||
          msg.content.startsWith("<") ||
          msg.content.startsWith("||") ||
          msg.content.length <= 0
        ) {
          return;
        }
        // Skip other bots except ours
        if (msg.author.id !== client.user?.id && msg.author.bot) return;

        let userContent = msg.content;
        if (!initialIsCapital(userContent)) {
          userContent = capitalizeFirstLetter(userContent);
        }
        userContent = addPeriod(userContent);

        let userName = msg.author.username;
        if (!initialIsCapital(msg.author.username)) {
          userName = capitalizeFirstLetter(msg.author.username);
        }

        // If the message is from our Bot
        if (msg.author.id === client.user?.id) {
          // Replace 'Rosemi' with botName automatically if needed in old logs
          chatInput += `${botStart}${botData.botName}: ${msg.content}\n${mlEnd}`;
        } else {
          chatInput += `${userStart}${userData.nickname}: ${userContent}\n${mlEnd}`;
        }

        // Refresh or reset detection
        if (
          msg.content.startsWith("=refresh") ||
          msg.content.startsWith("=reset")
        ) {
          chatInput = injection;
        }
      });

      // Finally add the next assistant start
      chatInput += `${botStart}${botData.botName}: `;

      console.log(chatInput);

      convertMentionsToNicknames(chatInput, message.guild?.id as string);
      // Generate from Google
      const reply = await model.generateContent([chatInput]);

      console.log(`\n\n` + reply.response.text());

      // Chunk and send
      const chunkedMessage = chunkMessage(reply.response.text());
      chunkedMessage.forEach((chunk) => {
        if (chunk.length > 5) {
          if (message.channel instanceof TextChannel) {
            message.channel.send(trimBotName(trimML(chunk), botData.botName));
          }
        }
      });
    }
  } catch (err) {
    message.channel.send(
      "||(｡>﹏<｡) Looks like Gemini blocked my generation response as it may have violated Google safety measures... have a flower instead! :rose:||"
    );
    console.log(err);
  }
}

// Helper function #1: getCurrentTime
function getCurrentTime(): string {
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const date = new Date();
  const weekday = getDayOfWeek(date);
  const day = date.getDate();
  const year = date.getFullYear();
  let hour = date.getHours();
  const minutes = date.getMinutes();
  let mid = "AM";

  if (hour === 0) {
    hour = 12;
  } else if (hour === 12) {
    mid = "PM";
  } else if (hour > 12) {
    hour = hour % 12;
    mid = "PM";
  }

  const month = monthNames[date.getMonth()];
  return `${month} ${day}, ${year} | ${hour}:${minutes} ${mid} | ${weekday}`;
}

// Helper function #2: chunkMessage
function chunkMessage(inputText: string): string[] {
  const nSplitMessage = inputText.split("\n");
  const chunkedMessage: string[] = [];
  let chunkIndex = 0;
  let tempMessage = "";

  nSplitMessage.forEach((msgLine) => {
    if (tempMessage.length >= 1500) {
      chunkedMessage[chunkIndex] = tempMessage;
      tempMessage = "";
      chunkIndex++;
    }
    tempMessage += msgLine + "\n";
  });

  if (tempMessage.length > 0) {
    chunkedMessage[chunkIndex] = tempMessage;
  }
  if (chunkedMessage.length === 0) {
    chunkedMessage[0] = tempMessage;
  }
  return chunkedMessage;
}

// Helper functions from your original code
function initialIsCapital(word: string): boolean {
  const hasLetter = /[a-zA-Z]/.test(word);
  if (!hasLetter) return false;
  return word[0] !== word[0].toLowerCase();
}

function capitalizeFirstLetter(text: string): string {
  const hasLetter = /[a-zA-Z]/.test(text);
  if (!hasLetter) {
    return text;
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function addPeriod(sentence: string): string {
  if (typeof sentence === "string" && sentence.length > 0) {
    if (!sentence.match(/[.,:!?]$/)) {
      sentence = sentence + ".";
    }
  }
  return sentence;
}

function getDayOfWeek(date: Date): string {
  const dayOfWeek = new Date(date).getDay();
  return isNaN(dayOfWeek)
    ? ""
    : [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
      ][dayOfWeek];
}

function trimML(text: string): string {
  if (text.endsWith("<|im_end|>")) {
    return text.slice(0, -10);
  } else if (text.endsWith("<|im_end|>\n")) {
    return text.slice(0, -12);
  }
  return text;
}

function trimBotName(text: string, botName: string): string {
  if (text.startsWith(`${botName}:`)) {
    return text.slice(botName.length);
  }
  return text;
}
