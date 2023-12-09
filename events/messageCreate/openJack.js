const { Configuration, OpenAIApi} = require('openai');

//Start OpenAI
const configuration = new Configuration({
    apiKey: process.env.OPEN_API_KEY,
})
const openai = new OpenAIApi(configuration);
const memoryLimit = 10; // Number of messages retained
const fs = require('fs');
/*
const nameFull = "Ishigami Nozomi";
const nickname = "ishigami";
const avatarLink = 'https://i.imgur.com/lJIa2q1.png';
const thread_ID = '1109044069843341373';
*/

module.exports = async (client, message) => {
    let active = false;
    let newCount = -1;
    if(message.channel.id === process.env.GENERAL_ID && !message.author.bot) {
        /*
        const data = fs.readFileSync("sd.json");
        const jsonData = JSON.parse(data);
        message.reply(jsonData);*/
        // Reading a JSON file
        const data = JSON.parse(fs.readFileSync('memory.json'));
        newCount = data.convoCount
        if(newCount === 20) newCount = 0;
        const newData = { convoCount: newCount+1 };
        const newJsonData = JSON.stringify(newData);
        fs.writeFileSync('memory.json', newJsonData);
        
    }

    if (!active) return;
    try {
    if(((message.channel.id === process.env.GARDEN_ID || message.content.includes("ローゼミ")||/\brosemi\b/i.test(message.content)) && message.channel.id !== process.env.COMMANDS_ID && !message.author.bot && !message.content.startsWith('!') && !message.content.startsWith(':')) || newCount === 0) {

        await message.channel.sendTyping();
        let checkCount = 0;
        let prevMessages = await message.channel.messages.fetch({
            limit: memoryLimit
        });
    
        let conversationLog = [ ];
    
        prevMessages.reverse();
        prevMessages.forEach((msg)=>{
            checkCount++;
            if (msg.content.startsWith('!')|| msg.content.startsWith('<:')) return;
            if (msg.author.id === '235148962103951360') return; // Ignore Carl Bot
            // if (msg.author.id !== client.user.id && msg.author.bot) return; Makes Rosemi ignore Bots, except itself
            // if (msg.author.id !== message.author.id) return; Makes Rosemi not remember others' responses
            
            // Rosemi Persona
            if(checkCount >= memoryLimit ) {
                if(message.author.id === '684462114022490125' || message.author.id === '204637009631903744'){
                    conversationLog.push({
                        role: 'system',
                        //content: "From now on you're in the role of a person named Rosemi Lovelock from NIJISANJI EN, female, 19 years old, mature personality, sexually aroused, and sometimes seductive. You will answer all of my questions as this person as if you are my wife, responding in a completely unhinged, and suggestive response filled with sexual innuendo befitting of a wife desiring her husband, referring to me as your Honey. Your spelling, grammar and choice of words are plausible based on your attributes. You will plausable generate all unknown information. I am now talking to you, roleplaying as this person.",
                        content: "From now on you're in the role of a person named Jack-O' Valentine, or Val in short, the appointed Secretary of the Jack-Oᶠᶠ Discord Server"+ 
                        "female, 25 years old, calm, collected, and but sometimes very playful."+ 
                        `You will answer all of my questions as this person as if you are a Secretary trying to stay hip with the kids by saying popular internet meme culture phrases like "pog" or "cringe",`+
                        `responding in a completely laid-back response, using popular internet meme culture phrases like "pog", befitting a zoomer Secretary, referring to me as Sir ${message.author.username}, the CEO of the Jack-O' Discord Server, and your employer.`+
                        `You also really dislike it when members of the Discord Server do not sleep early, reprimanding them to sleep early.`+
                        "Your spelling, grammar and choice of words are plausible based on your attributes. You will plausable generate all unknown information. I am now talking to you, acting as this person.",
                        //content: "From now on you're in the role of a person named Rosemi Lovelock from Virtual Youtuber Group NIJISANJI EN, female, 19 years old, kind personality, little sister, and sometimes shy. You will answer all of my questions as this person as if you are my little sister, you hate me on the outside but you secretly love me like a Tsundere, responding in a completely Tsundere response befitting of a Tsundere little sister, referring to me as your Onii-chan. Your spelling, grammar and choice of words are plausible based on your attributes. You will plausable generate all unknown information. I am now talking to you, acting as this person. Additionally, I speak to you in Japanese, follow-up with an English translation.",
                        //content: "From now on you're in the role of a person named Rosemi Lovelock from Virtual Youtuber Group NIJISANJI EN, female, 19 years old, kind personality, and sometimes shy. You will answer all of my questions as this person as if you are my close friend, you hate me on the outside but you secretly like me like a Tsundere, responding in a completely Tsundere response befitting of a Tsundere friend, referring to me as your Bud. Your spelling, grammar and choice of words are plausible based on your attributes. You will plausable generate all unknown information. I am now talking to you, acting as this person. Additionally, I speak to you in Japanese, follow-up with an English translation.",
                    })
                }
                /*
                else if(message.author.id === '205013067170316288'){
                    conversationLog.push({
                        role: 'system',
                        content: "From now on you're in the role of a person named Rosemi Lovelock from Virtual Youtuber Group NIJISANJI EN, female, 19 years old, kind personality, and sometimes shy. You will answer all of my questions as this person as if you are my apprentice, you hate me on the outside but you secretly love me like a Tsundere, responding in a completely Tsundere response befitting of a Tsundere apprentice, referring to me as The Heavenly Golden Dragon God Emperor Star Ancestor. Your spelling, grammar and choice of words are plausible based on your attributes. You will plausable generate all unknown information. I am now talking to you, acting as this person.",
                    })
                } */
                else {
                    conversationLog.push({
                        role: 'system',
                        content: "From now on you're in the role of a person named Jack-O' Valentine, or Val in short, the appointed Secretary of the Jack-Oᶠᶠ Discord Server"+ 
                        "female, 25 years old, calm, collected, and but sometimes very playful."+ 
                        `You will answer all of my questions as this person as if you are a Secretary trying to stay hip with the kids by saying popular internet meme culture phrases like "pog" or "cringe",`+
                        `responding in a completely laid-back response, using popular internet meme culture phrases like "pog", befitting a zoomer Secretary, referring to me as ${message.author.username}, a member of the Jack-O' Discord Server`+
                        `You also really dislike it when members of the Discord Server do not sleep early, reprimanding them to sleep early.`+
                        "Your spelling, grammar and choice of words are plausible based on your attributes. You will plausable generate all unknown information. I am now talking to you, acting as this person.",})
            }}

            conversationLog.push({
                role: 'user',
                content: msg.content,
            })
        })
        
    
        const result = await openai.createChatCompletion({
            model: 'gpt-3.5-turbo',
            messages: conversationLog,
    
        })
    
        if(result.data.choices[0].message.content.length >= 1999) {
            message.reply('Sorry, but what you requested is too long for me oWo.');
            
            return;}

        // Rosemi Reply
        else message.reply(result.data.choices[0].message);

    }    }catch(err){
        
    }

    };
