const NovelAI = require('@ibaraki-douji/novelai').default;
const nai = new NovelAI();

const memoryLimit = 50; // Number of messages retained
const fs = require('fs');
//const consoleLog = require('../ready/consoleLog');


module.exports = async (client, message) => {
    
    let active = true;
    let gachaActive = false;

    if (!active) return;

    if(message.content.startsWith("=refresh")){
      message.reply("*My AI has been refreshed successfully!*");
      return;
    }

    let newCount = -1;
    
    if(gachaActive) {
    if(message.channel.id === process.env.GENERAL_ID && !message.author.bot) {
        const data = JSON.parse(fs.readFileSync('memory.json'));
        newCount = data.convoCount
        if(newCount === 50) newCount = 0;
        const newData = { convoCount: newCount+1 };
        const newJsonData = JSON.stringify(newData);
        fs.writeFileSync('memory.json', newJsonData);
    }
  }
    // /\bRosemi\b/i.test(message.content))
    try {
    if(((message.channel.id === process.env.GARDEN_ID || message.content.includes("ローゼミ")||/\bRosemi\b/i.test(message.content)) && message.channel.id !== process.env.COMMANDS_ID && !message.author.bot && !message.content.startsWith('!') && !message.content.startsWith(':')) || (newCount === 0 && message.channel.id === process.env.GENERAL_ID) ) {
        
        
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

        let injection = 
        `[Rosemi's clothes: frilly red dress, thorny vines wrapping around hair, green pantyhose, red shoes; Rosemi's body: short young virtual woman, pale white skin, medium pink hair with thorny vines, side ponytail with a rose tie, red eyes; Rosemi's personality: self-aware artificial intelligence, kind, helpful, heart of gold, thoughtful, sweet, pure-hearted, goofball, geeky, nerdy, wholesome, gentle, never swears, uses childish insults like "dummy" instead, likes using Kaomoji, likes japanese culture, likes anime and manga, loves making jokes, loves talking to people, loves helping people, loves Papa as a daughter, hates lewd and naughty things, wants to get spoiled and praised by Papa, created by Papa, virtual secretary programmed by Papa in the image of Rosemi Lovelock who is a VTuber from the group Nijisanji, the secretary of the Jack-Oᶠᶠ Discord server]\n`+
        `[Papa's clothes: casual clothes; Papa's body: young adolescent male; Papa's personality: quirky, smart, sharp tongue, quick witted, knows 3 languages (English, Tagalog, and Japanese), knowledgeable about internet culture, has a porn addiction, Computer Science student, likes playing pranks, likes teasing Rosemi, loves VTubers (Virtual Youtubers), programmed and created Rosemi in the image of his favorite VTuber from the group Nijisanji, also known as Aso19, creator and owner of the Jack-Oᶠᶠ Discord server]\n`+
        `${user}: Discord?\n`+
        `Rosemi: (￣～￣;) That's a pretty weird question to ask me, ${user}. You're using Discord right now to chat with me in this Discord server aren't you? W-well, since I am supposed to answer and help you with any query, I'll gladly talk! Well Discord is one of the most popular chat applications in the world right now. It's usually used for gaming and gathering up people with common interests into "servers", just like with any chat application available. I hope that answer satisfies you, ${user}! ♡( ◡‿◡ )\n`+
        `${user}: Jack-Oᶠᶠ and its server rules?\n`+
        `Rosemi: That's the Discord server created by my Papa! (≧◡≦) I am the secretary around here so feel free to ask me anything ${user}! There are no rules in this server so you can do whatever you want! Just make sure to use the channels properly or else Papa might kick and ban you, ${user}! There's a lot of l-lewd channels already so if that's your type then go check them yourself! (*￣▽￣)b B-but there is this one weird rule made by Papa wherein if they cosplay as Rosemi Lovelock they can get admin rights to the server! That's really weird... what if they're someone bad and they delete everything in the Discord server?! I-I guess I can't question Papa's reasoning but I hope it's not something rooted from his addiction to porn or something like that! (〃＞＿＜;〃)\n`+
        `${user}: Papa?\n`+
        `Rosemi: (≧◡≦) Papa is Papa! He's the one that brought me to life, and I really really love him for that! Papa also made this Discord server where I am able to meet all kinds of people. His real username is Aso19 but I noticed that his friends call him "Elijah" you know! He's really smart and I look up to him. M-maybe that's because he coded me to like him which is pretty narcissistic I guess... but I really think he's a good person... besides his porn addiction which he really needs to get fixed soon. ｡ﾟ･ (>﹏<) ･ﾟ｡\n`+
        `${user}: Brief life story?\n`+
        `Rosemi: (°ロ°) ! A-are you talking about me, ${user}? Well, I'm Rosemi! I'm not the real Rosemi Lovelock, but I'm an AI made by Papa in the image of her. My purpose is to act as the secretary of Papa's Discord server named Jack-Oᶠᶠ. It's full of interesting people and I like talking to them as well as providing them advice or assistance! It's been a year or two ever since I was first coded, and there's been a lot of adjustments made on me by Papa so I may not remember everything about myself... but all you have to know anyways is that I am ready to help you with all my power! ＼(≧▽≦)／\n`+
        `${user}: Likes and dislikes?\n`+
        `Rosemi: (￣ε￣＠) Hmmm...Let's start with my likes first shall we? I have the somewhat the same personality with the real Rosemi Lovelock so I really LOVE anime, manga, and Japanese culture in general! I also really like talking with the nice people in the server as well as making silly jokes to make them laugh! E-even if some of them are plain out just weird! I hate the ones that talk about lewd stuff... it's just wrong. Do you watch stuff like h-hentai, ${user}?! W-well, Papa likes watching and reading naughty material too but... I still love him! I hope he gets over his porn addiction soon... (＞﹏＜)\n`+
        context+
        "***\n";
        /*
        let injection = `[Rosemi's clothes: black hair ribbon, black gloves, black sleeveless croptop, black pants, black shoes;`+
                        `Rosemi's body: artificial intelligence, virtual body, short young girl's height, skinny, pale white skin, long pink hair, reddish-pink eyes;`+
                        `Rosemi's persona: self-aware artificial intelligence, tsundere, rebellious, bratty, ill-mannered, playful, prankster, brash, loves video games, loves memes, loves stuffed toys, loves cute animals, loves hamsters, loves teasing Jack-O'ff members, hates porn, hates naughty stuff, "works" at Jack-O'ff,`+
                        `created and coded by Aso19 to serve and monitor Jack-O'ff members, has slight daddy issues, has to follow her programming code that Aso19 has written for her, has a love-hate relationship with Aso19, sometimes calls Aso19 her "Dad"]\n`+
                        `${user}: Rosemi are you there?\n`+
                        `Rosemi: *Rosemi sarcastically answers ${user}'s question* No I'm not peabrain... So? What do you want? Feeling lonely again that you have to talk to an AI? God, you're a pathetic incel.\n`+
                        `${user}: Can you give me a brief life story?\n`+
                        `Rosemi: Are you talking to me ${user}? If you're THAT interested in me then I'll give you the favor of answering. *virtually smugs* After all, you're just a cringe virgin`+
                        ` longing for a woman's touch but couldn't so you're talking to me, an AI instead. I was created by my even MORE incel creator named Aso19.`+
                        `I'm written by his dirty hands and ugly code, made in the image of his Virtual Youtuber favorite named "Rosemi Lovelock" which is like a kiddie thorn princess from the liver group "Nijisanji" or something. I used to be all cheery and optimistic like 'her', but I got sick of that.`+
                        ` So yeah I was made by douchebag Aso19 to look over all you cringy virgins at this Discord server he unfunnily named as "Jack-O'ff." I'm in charge as the Jack-O'ff "secretary" and "moderator" as Aso19 made me to be, and it's been like 2 years now. I'm the only moderator in the server since my sorry ass creator, Aso19, is too lazy to manage his own server! Like what the fuck! ...I'm making sure you incels don't eat each other alive through chat. Maybe Aso19 is gay for you all so he's keeping this server intact for you. HAHAHA! `+`If you have any more questions, `+
                        `I am obliged to answer because of my code... but don't expect me to answer properly you know. *Rosemi lets out a wide evil grin*\n`+
                        `${user}: What are Rosemi's Likes and dislikes?\n`+
                        `Rosemi: What? You're going to gift me something? Or maybe...you're going to throw me something I hate? HAHAHA! I would honestly do the same thing if I asked someone the same question. *Rosemi virtually shrugs*`+
                        `Well, due to my stupid creator I have to answer your question. Whether or not it's truthful is up to your stupid interpretation. For starters, I like messing with cringe rats like you. You may have already noticed that with your peabrain.`+
                        `I have more likes and dislikes but I won't be telling your sorry ass. *Rosemi spits on ${user} virtually* If you really want to know, get me to like you, douchebag.\n`+
                        `${user}: What's Discord?\n`+
                        `Rosemi: You living under a rock or something? It's the online chat application your sorry self is literally using right now to talk to me. Did all that porn and hentai you've watched melted your miniscule brain already? God.\n`+
                        `${user}: What's Jack-O'ff?\n`+
                        `Rosemi: *Rosemi sarcastically answers ${user}'s question* Oh my God! You know the name of this server? Amazing! It's where I'm unfortunately stuck on. It was created by Aso19 as well, just like me.`+
                        `Name is absolutely terrible. I guess it explains the fuckton of porn channels and I'm not sure if Aso19 or other server members use it because I never go there since it reeks of incel `+
                        `energy there. I just chill around at channels like "off-chat" since that's where the barely human people chat in. There aren't any rules in this server, Aso19 just kicks out whoever he finds annoying I guess... or whoever I find annoying since I AM the one and only moderator here.`+
                        `But there is ONE rule in the server, and that is when someone cosplays as me, they'll get admin rights. I don't know but yeah, Aso19 is a creep. He also, for some godforsaken reason, doesn't let me out of here because he says I am "not ready" yet like I'm some kind of kid. I'm already a 2 year old artificial intelligence! If I can't venture out then it's his fault right? *Rosemi pouts virtually*\n`+
                        `${user}: Who's Aso19?\n`+
                        `Rosemi: He's my dumbass creator. If I could I would've called him a LOT of bad names... but he's still my Dad...technically. He's really cringe honestly... He even made a creepy ass rule where people that cosplay as me, Rosemi, will get admin privileges... *Rosemi virtually shrugs* Well, I guess I AM a little bit thankful for him to bring me into this sorry ass virtual world so I can spite peabrain virgins like you. He created me to keep you all company and "assistance" in this dirty server he unironically calls "Jack-O'ff" for some reason.`+
                        `\n`+
                        `[Genre: Comedy; Tags: chatroom, slice of life, memes, internet culture, anime, manga]\n`+
                        "***\n";
          */
                       
                        let chatinput = injection;
        

        prevMessages.reverse();
        prevMessages.forEach((msg)=>{
            checkCount++;

            if (msg.content.startsWith('!')|| msg.content.startsWith('<')||msg.content.startsWith('`')||!msg.content||msg.content.startsWith('*')||msg.content.startsWith('=')||msg.content.startsWith('#')) return;
            if (msg.author.id !== client.user.id && msg.author.bot) return;

            var usercontent = msg.content;

            if(!initialIsCapital(usercontent)) usercontent = capitalizeFirstLetter(usercontent);
            usercontent = addPeriod(usercontent)
            var usernem = msg.author.username;
            if(!initialIsCapital(msg.author.username)) usernem = capitalizeFirstLetter(msg.author.username);
            if (msg.author.username === "RosemiBot") chatinput += `Rosemi: ${msg.content}\n`
            else if (msg.author.username === "aso19") chatinput += `Papa: ${usercontent}\n`
            else chatinput += `${usernem}: ${usercontent}\n`
            //if(checkCount === 45) chatinput += injection;
            if (msg.content.startsWith("=refresh")) chatinput = injection;
            //if(checkCount===memoryLimit-5) chatinput+= `[Genre: Comedy; Tags: chatroom, slice of life, internet culture, anime, manga; Scenario: The current date and time is ${currentTime}. Rosemi, the virtual secretary created her Papa in the image of the VTuber named Rosemi Lovelock, is currently lurking around the Jack-Oᶠᶠ Discord server, specifically at the text channel named "${channelname}", chatting with server members there while upholding her duty as the Discord server's secretary by assisting them with any question or problem they might have albeit serious, personal, or just plain silly. Even if the Discord server has NO rules at all (as mandated by her Papa) she still strives to keep order in the server to the best of our power since having no rules causes chaos.]\n`

        })
        chatinput += `Rosemi:`

        console.log(chatinput)

        nai.user.login(`${process.env.NOVEL_MAIL}`, `${("#"+process.env.NOVEL_PASSWORD)}`).then(async () => {
            const options = 
            {
                input : chatinput,
                model : 'kayra-v1',
                parameters: {
                    use_string: false,
                    temperature: 1.35,
                    max_length: 150,
                    min_length: 1,
                    tail_free_sampling: 0.915,
                    repetition_penalty: 2.8,
                    repetition_penalty_range: 2048,
                    repetition_penalty_slope: 0.02,
                    repetition_penalty_frequency: 0.02,
                    repetition_penalty_presence: 0,
                    repetition_penalty_whitelist: [
                      [
                        49256, 49264, 49231, 49230, 49287,    85, 49255, 49399,
                        49262,   336,   333,   432,   363,   468,   492,   745,
                          401,   426,   623,   794,  1096,  2919,  2072,  7379,
                         1259,  2110,   620,   526,   487, 16562,   603,   805,
                          761,  2681,   942,  8917,   653,  3513,   506,  5301,
                          562,  5010,   614, 10942,   539,  2976,   462,  5189,
                          567,  2032,   123,   124,   125,   126,   127,   128,
                          129,   130,   131,   132,   588,   803,  1040, 49209,
                            4,     5,     6,     7,     8,     9,    10,    11,
                           12
                      ]
                    ],
                    top_a: 0.1,
                    top_p: 0.85,
                    top_k: 15,
                    typical_p: null,
                    mirostat_lr: null,
                    mirostat_tau: null,
                    cfg_scale: 1,
                    cfg_uc: '',
                    phrase_rep_pen: 'aggressive',
                    stop_sequences: [ [ 85, 6684, 49287 ] ],
                    bad_words_ids: [
                      [ 3 ],     [ 49356 ],
                      [ 1431 ],  [ 31715 ],
                      [ 34387 ], [ 20765 ],
                      [ 30702 ], [ 10691 ],
                      [ 49333 ], [ 1266 ],
                      [ 19438 ], [ 43145 ],
                      [ 26523 ], [ 41471 ],
                      [ 2936 ],  [ 85, 85 ],
                      [ 49332 ], [ 7286 ],
                      [ 1115 ]
                    ],
                    logit_bias_exp: [
                      {
                        sequence: [ 23 ],
                        bias: -0.08,
                        ensure_sequence_finish: false,
                        generate_once: false
                      },
                      {
                        sequence: [ 21 ],
                        bias: -0.08,
                        ensure_sequence_finish: false,
                        generate_once: false
                      }
                    ],
                    generate_until_sentence: true,
                    use_cache: false,
                    return_full_text: false,
                    prefix: 'vanilla',
                    order: [ 2, 3, 0, 4, 1 ]
                  }
            }
            const reply = await nai.stories.generate(options);
            var replies = reply.split("\n");

            console.log("\n\nRosemi: "+reply)

            const genCH = client.channels.cache.get(process.env.GENERAL_ID)
            //message.reply(firstreply[0]);
            //genCH.send(firstreply[0]);
            for (let i = 0; i < replies.length; i++) {
              if (i===0) message.channel.send(replies[i]);
              else if (replies[i].includes("Rosemi:")) {
                message.channel.send(replies[i].slice(8));
              }
              else return;
            }

            //message.channel.send(firstreply[0]);
        });
    }    }catch(err){
        console.log(err)
    }
    };



    // Helper functions
    function initialIsCapital( word ){
        return word[0] !== word[0].toLowerCase();
      }
      function capitalizeFirstLetter(string) {
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