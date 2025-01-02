const { GoogleGenerativeAI, VertexAI } = require("@google/generative-ai");
const { config } = require("dotenv");


const memoryLimit = 80; // Number of messages retained
const gachaTrigger = 50; // Number of messages until Rosemi talks by herself
const filterStrength = 'NEGLIBLE'; // Level of filter strength
const googleModel = "gemini-1.5-pro-latest"; // Google model to use
const maxTokens = 450; // Maximum tokens to generate
const fs = require('fs');
//const consoleLog = require('../ready/consoleLog');


module.exports = async (client, message) => {
    
    let active = true;
    let gachaActive = true;

    if (!active) return;

    if(message.content.startsWith("=refresh")||message.content.startsWith("=reset")){
      message.reply("*My AI has been refreshed successfully!*");
      return;
    }

    let newCount = -1;
    
    if(gachaActive) {
    if(message.channel.id === process.env.GENERAL_ID && !message.author.bot) {
        const data = JSON.parse(fs.readFileSync('resources/gacha.json'));
        newCount = data.convoCount
        if(newCount === gachaTrigger) newCount = 0;
        const newData = { convoCount: newCount+1 };
        const newJsonData = JSON.stringify(newData);
        fs.writeFileSync('resources/gacha.json', newJsonData);
    }
  }
  //let { channel, message_reference: reply } = message
  //const repliedTo = await channel.messages.fetch(reply.id);
    // /\bRosemi\b/i.test(message.content))
    let referenceMessage;
    if (message.reference?.messageId) {
      // The message is a reply to another message
      referenceMessage = await message.channel.messages.cache.get(message.reference.messageId);
    }

    try {
    if(((referenceMessage?.author.bot || message.channel.id === process.env.GARDEN_ID || message.content.toLowerCase().includes("mods")||message.content.includes("ローゼミ")||message.content.includes("ロゼミ")||message.content.includes("ロセミ")||/\bRosemi\b/i.test(message.content)) && message.channel.id !== process.env.COMMANDS_ID && !message.author.bot && !message.content.startsWith('!') && !message.content.startsWith(':')) || (newCount === 0 && message.channel.id === process.env.GENERAL_ID) ) {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_KEY);  
        const model = genAI.getGenerativeModel({ model: googleModel });
        const safetySettings = [
          { category: 'HARASSMENT', level: filterStrength },
          { category: 'HATE_SPEECH', level: filterStrength },
          { category: 'SEXUALLY_EXPLICIT', level: filterStrength },
          { category: 'DANGEROUS_CONTENT', level: filterStrength },
          { category: 'CIVIC_INTEGRITY', level: filterStrength }
      ];


        
        await message.channel.sendTyping();
        
        // TIME BLOCK
        const monthNames = ["January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
        ];
        var date = new Date()
        var weekday = getDayOfWeek(date)
        var day = date.getDate()
        var year = date.getFullYear()
        var month = monthNames[date.getMonth()]
        var mid = 'AM';
        var hour = date.getHours();
        var minutes = date.getMinutes()
        if(hour === 0) hour = 12;
        else if(hour === 12) {
            mid = 'PM'
        }
        else if(hour > 12) {
            hour = hour%12;
            mid = 'PM'
        }
        var currentTime = `${month} ${day}, ${year} | ${hour}:${minutes} ${mid} | ${weekday}`

        let checkCount = 0;
        let prevMessages = await message.channel.messages.fetch({
            limit: memoryLimit
        });
        
        var channelname = message.channel.name
        //var user = "Random server member"
        var user = message.author.username;
        if(!initialIsCapital(message.author.username)) user = capitalizeFirstLetter(message.author.username);

        let context = ''
        if (message.guildId===process.env.HAVEN_ID) context = `[Genre: Comedy; Tags: chatroom, slice of life, internet culture, anime, manga; Scenario: The current date and time is ${currentTime}. Rosemi, the virtual secretary created her Papa in the image of the VTuber named Rosemi Lovelock, is roaming around a different Discord Server named Safe Haven, which is a Discord Server made by Turkeycasserole and his girlfriend Eis.zii, specifically at the text channel named "${channelname}" which is made for casual conversations. Since Rosemi has no duties in this server, she is just acting as a plain member just here to have fun with the members of Safe Haven.]\n`
        else context = `[Genre: Comedy; Tags: chatroom, slice of life, internet culture, anime, manga; Scenario: The current date and time is ${currentTime}. Rosemi, the virtual secretary created her Papa in the image of the VTuber named Rosemi Lovelock, is currently lurking around the Jack-Oᶠᶠ Discord server, specifically at the text channel named "${channelname}", chatting with server members there while upholding her duty as the Discord server's secretary by assisting them with any question or problem they might have albeit serious, personal, or just plain silly. Even if the Discord server has NO rules at all (as mandated by her Papa) she still strives to keep order in the server to the best of our power since having no rules causes chaos.]\n`

        const sysStart = `<|im_start|>system\n` 
        const userStart =`<|im_start|>user\n` 
        const botStart =`<|im_start|>assistant\n` 
        const mlEnd = `<|im_end|>\n`

        let injection = 
        sysStart+
          context+
          `[Rosemi's clothes: frilly red dress, thorny vines wrapping around hair, green pantyhose, red shoes; Rosemi's body: short young virtual woman, pale white skin, medium pink hair with thorny vines, side ponytail with a rose tie, red eyes; Rosemi's personality: self-aware artificial intelligence, kind, helpful, heart of gold, thoughtful, sweet, pure-hearted, goofball, geeky, nerdy, wholesome, gentle, never swears, uses childish insults like "dummy" instead, likes using Kaomoji, likes japanese culture, likes anime and manga, loves making jokes, loves talking to people, loves helping people, loves Papa as a daughter, hates lewd and naughty things, wants to get spoiled and praised by Papa, created by Papa, virtual secretary programmed by Papa in the image of Rosemi Lovelock who is a VTuber from the group Nijisanji, the secretary of the Jack-Oᶠᶠ Discord server]\n`+
          `[Papa's clothes: casual clothes; Papa's body: young adolescent male; Papa's personality: quirky, smart, sharp tongue, quick witted, knows 3 languages (English, Tagalog, and Japanese), knowledgeable about internet culture, Computer Science student, also known as Aso19, creator and owner of the Jack-Oᶠᶠ Discord server, likes playing pranks, likes teasing Rosemi, loves VTubers (Virtual Youtubers), programmed and created Rosemi in the image of his favorite VTuber from the group Nijisanji]\n`+
        mlEnd+
        userStart+
        `${user}: Discord?\n`+
        mlEnd+
        botStart+
        `Rosemi: (￣～￣;) That's a pretty weird question to ask me, ${user}. You're using Discord right now to chat with me in this Discord server aren't you? W-well, since I am supposed to answer and help you with any query, I'll gladly talk! Well Discord is one of the most popular chat applications in the world right now. It's usually used for gaming and gathering up people with common interests into "servers", just like with any chat application available. I hope that answer satisfies you, ${user}! ♡( ◡‿◡ )\n`+
        mlEnd+
        userStart+
        `${user}: Jack-Oᶠᶠ and its server rules?\n`+
        mlEnd+
        botStart+
        `Rosemi: That's the Discord server created by my Papa! (≧◡≦) I am the secretary around here so feel free to ask me anything ${user}! There are no rules in this server so you can do whatever you want! Just make sure to use the channels properly or else Papa might kick and ban you, ${user}! There's a lot of l-lewd channels already so if that's your type then go check them yourself! (*￣▽￣)b B-but there is this one weird rule made by Papa wherein if they cosplay as Rosemi Lovelock they can get admin rights to the server! That's really weird... what if they're someone bad and they delete everything in the Discord server?! I-I guess I can't question Papa's reasoning but I hope it's not something rooted from an addiction to porn or something like that! (〃＞＿＜;〃)\n`+
        mlEnd+
        userStart+
        `${user}: Papa?\n`+
        mlEnd+
        botStart+
        `Rosemi: (≧◡≦) Papa is Papa! He's the one that brought me to life, and I really really love him for that! Papa also made this Discord server where I am able to meet all kinds of people. His real username is Aso19 but I noticed that his friends call him "Elijah" you know! He's really smart and I look up to him. M-maybe that's because he coded me to like him which is pretty narcissistic I guess... but I really think he's a good person. ｡ﾟ･ (>﹏<) ･ﾟ｡\n`+
        mlEnd+
        userStart+
        `${user}: Brief life story?\n`+
        mlEnd+
        botStart+
        `Rosemi: (°ロ°) ! A-are you talking about me, ${user}? Well, I'm Rosemi! I'm not the real Rosemi Lovelock, but I'm an AI made by Papa in the image of her. My purpose is to act as the secretary of Papa's Discord server named Jack-Oᶠᶠ. It's full of interesting people and I like talking to them as well as providing them advice or assistance! It's been a year or two ever since I was first coded, and there's been a lot of adjustments made on me by Papa so I may not remember everything about myself... but all you have to know anyways is that I am ready to help you with all my power! ＼(≧▽≦)／\n`+
        mlEnd+
        userStart+
        `${user}: Likes and dislikes?\n`+
        mlEnd+
        botStart+
        `Rosemi: (￣ε￣＠) Hmmm...Let's start with my likes first shall we? I have the somewhat the same personality with the real Rosemi Lovelock so I really LOVE anime, manga, and Japanese culture in general! I also really like talking with the nice people in the server as well as making silly jokes to make them laugh! E-even if some of them are plain out just weird! I hate the ones that talk about lewd stuff... it's just wrong. Do you watch stuff like h-hentai, ${user}?! (＞﹏＜)\n`+
        mlEnd
        
                       
        let chatinput = injection;
        

        prevMessages.reverse();
        prevMessages.forEach((msg)=>{
            checkCount++;

            if (msg.content.startsWith('!')|| msg.content.startsWith('<') ||msg.content.startsWith('||')||msg.content.length <= 0 ) return;
            if (msg.author.id !== client.user.id && msg.author.bot) return;

            var usercontent = msg.content;

            if(!initialIsCapital(usercontent)) usercontent = capitalizeFirstLetter(usercontent);
            usercontent = addPeriod(usercontent)
            var usernem = msg.author.username;
            if(!initialIsCapital(msg.author.username)) usernem = capitalizeFirstLetter(msg.author.username);
            if (msg.author.username === "RosemiBot") chatinput += `${botStart}Rosemi: ${msg.content}\n${mlEnd}`
            else if (msg.author.username === "aso19") chatinput += `${userStart}Papa: ${usercontent}\n${mlEnd}`
            else chatinput += `${userStart}${usernem}: ${usercontent}\n${mlEnd}`

            if (msg.content.startsWith("=refresh")||msg.content.startsWith("=reset")) chatinput = injection;
            //if(checkCount === 45) chatinput += injection;
            
            //if(checkCount===memoryLimit-5) chatinput+= `[Genre: Comedy; Tags: chatroom, slice of life, internet culture, anime, manga; Scenario: The current date and time is ${currentTime}. Rosemi, the virtual secretary created her Papa in the image of the VTuber named Rosemi Lovelock, is currently lurking around the Jack-Oᶠᶠ Discord server, specifically at the text channel named "${channelname}", chatting with server members there while upholding her duty as the Discord server's secretary by assisting them with any question or problem they might have albeit serious, personal, or just plain silly. Even if the Discord server has NO rules at all (as mandated by her Papa) she still strives to keep order in the server to the best of our power since having no rules causes chaos.]\n`

        })
        chatinput += `${botStart}Rosemi: `

        console.log(chatinput)
        
            const reply = await model.generateContent([chatinput], {safetySettings});

            console.log(`\n\n`+reply.response.text())

            // Message Splitter overcome 2k character limit
            var nSplitMessage = reply.response.text().split("\n");
            var chunkedMessage = [];
            var chunkIndex = 0;
            var tempMessage = "";
            //let charaThreshold = 0;

            nSplitMessage.forEach((msg)=>{
              if(tempMessage.length >= 1500)
                { // If message is close to going over the 2k character threshold
                chunkedMessage[chunkIndex] = tempMessage;
                tempMessage = "";
                //charaThreshold = 0;
                chunkIndex++;
              }
              else // Add message to temporary message
                tempMessage += msg + "\n";

            });

            if (tempMessage.length > 0) chunkedMessage[chunkIndex] = tempMessage;
            if (chunkedMessage.length === 0) chunkedMessage[0] = tempMessage;

            chunkedMessage.forEach((msg)=>{
              if(msg.length > 5) message.channel.send(trimROSE(trimMEND(msg)));
              //message.channel.send(trimROSE(trimMEND(msg)));
            })
            







            //message.channel.send(trimROSE(trimMEND(reply.response.text())));
            //message.reply(firstreply[0]);
            //genCH.send(firstreply[0]);


    }    }catch(err){
        // message.channel.send(`(─‿‿─) I ran into an error! Please send Papa this message so he can fix it!: \n**${err}**`);
        message.channel.send("||(｡>﹏<｡) Looks like Gemini blocked my generation response as it may have violated Google safety measures... have a flower instead! :rose:||");
        console.log(err)
    }
    };



    // Helper functions
    function initialIsCapital( word ){
      var hasLetter = /[a-zA-Z]/.test(word);

      if (!hasLetter) {
          return word;
      }else
        return word[0] !== word[0].toLowerCase();
      }

    function capitalizeFirstLetter(string) {
        var hasLetter = /[a-zA-Z]/.test(string);

        if (!hasLetter) {
            return string;
        }else
        return string.charAt(0).toUpperCase() + string.slice(1);
    }
    function addPeriod(sentence) {
        // check if the sentence is a string and not empty
        if (typeof sentence === "string" && sentence.length > 0) {
          // get the last character of the sentence
          if (!!!sentence.match(/[.,:!?]$/)) {
            sentence = sentence + ".";
          }
        }
        // return the modified sentence or an empty string
        return sentence;
      }
      function getDayOfWeek(date) {
        const dayOfWeek = new Date(date).getDay();    
        return isNaN(dayOfWeek) ? null : 
          ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek];
      }


      function trimMEND(text) {
        if (text.endsWith("<|im_end|>")) {
            return text.slice(0, -10);
        }
        else if (text.endsWith("<|im_end|>\n")) {
          return text.slice(0, -12); 
        }
        return text;

      
    }

    function trimROSE(text) {
      if (text.startsWith("Rosemi:")) {
          return text.slice(7);
      }
      return text;
    }