// Give access to .env file
require("dotenv").config();

// Discord Bot Initialization
const Discord = require("discord.js");
const mongoose = require("mongoose");
const { Client, IntentsBitField } = require("discord.js");
const client = new Client({
  intents: [
    // Set of permissions Rosemi has/needs!
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMembers,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.GuildPresences,
    IntentsBitField.Flags.MessageContent,
    IntentsBitField.Flags.GuildVoiceStates,
    IntentsBitField.Flags.DirectMessages,
    IntentsBitField.Flags.GuildMessageReactions,
  ],
  partials: [Discord.Partials.Channel, Discord.Partials.Message],
});
const eventHandler = require("./handlers/eventHandler");
eventHandler(client);

// Music bot functionality
const fs = require("fs");

client.commands = new Discord.Collection();
client.aliases = new Discord.Collection();

fs.readdir("./prefix_commands/", (err, files) => {
  if (err) return console.log("I could not find any commands!");
  const jsFiles = files.filter((f) => f.split(".").pop() === "js");
  if (jsFiles.length <= 0) return console.log("I could not find any commands!");
  jsFiles.forEach((file) => {
    const cmd = require(`./prefix_commands/${file}`);
    // console.log(`Loaded ${file}`)
    client.commands.set(cmd.name, cmd);
    if (cmd.aliases)
      cmd.aliases.forEach((alias) => client.aliases.set(alias, cmd.name));
  });
  //console.log(`All prefix commands up and running!`)
});

/*
client.on('ready', () => {
  console.log(`${client.user.tag} is ready to play music.`)
})
*/

client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;
  const prefix = process.env.PREFIX;
  if (!message.content.startsWith(prefix)) return;
  const args = message.content.slice(prefix.length).trim().split(/ +/g);
  const command = args.shift().toLowerCase();
  const cmd =
    client.commands.get(command) ||
    client.commands.get(client.aliases.get(command));
  if (!cmd) return;
  if (cmd.inVoiceChannel && !message.member.voice.channel) {
    return message.channel.send(
      `${client.emotes.error} | バカ！ You must be in a voice channel!`,
    );
  }
  try {
    cmd.run(client, message, args);
  } catch (e) {
    console.error(e);
    message.channel.send(
      `${client.emotes.error} | Oops! An error popped up: \`${e}\``,
    );
  }
});

/*
// Voice detection functonality
const { addSpeechEvent, SpeechEvents, resolveSpeechWithWitai } = require("discord-speech-recognition");
const { joinVoiceChannel } = require("@discordjs/voice");

addSpeechEvent(client, {
  speechRecognition: resolveSpeechWithWitai,
  lang: 'en-US', // ja-JP or en-US
  key: 'TCK4Z2R7KJKW2VITFABZPHMB3WXNQAWP',
  profanityFilter: false,
});
*/

// Connect to MongoDB
mongoose
  .connect(process.env.MONGODB_SRV, {})
  .then(() => {
    console.log("Connected to MongoDB!");
  })
  .catch((err) => {
    console.log(err);
  });

// Login Rosemi using our password (the Token)
client.login(process.env.DISCORD_TOKEN);
