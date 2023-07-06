var { Rosemi } = require('../ready/initCHRAI.js');
const CharacterAI = require('node_characterai');
const characterAI = new CharacterAI();
const api = process.env.CHRAI_API_KEY;
const persona = process.env.CHRAI_ROSEID;

module.exports = async (client, message) => {

try{
    if(message.content.startsWith("=refresh")){

        if(Rosemi !== undefined){
            await Rosemi.bot.saveAndStartNewChat();
            message.reply("*My AI has been refreshed successfully!*");
        }
        
        else {
            await characterAI.authenticateWithToken(api);
            Rosemi = {
                bot : await characterAI.createOrContinueChat(persona)
            }; 
            message.reply("*My AI has been refreshed successfully!*");
        }
    
    }
    
    else if(/\brosemi\b/i.test(message.content) && message.channel.id !== process.env.COMMANDS_ID && !message.author.bot) {
        if(Rosemi === undefined) {
            message.reply("*Rosemi seems to be sleeping, might as well let her be for now...*");
            return;
        }
        const userName = message.member.displayName;
        const meFilter =  `(OOC: This message was sent by Papa!)\n`;
        const otherFilter = `(OOC: This message was sent by ${userName}, who is not your Papa.)\n`;
    
        await message.channel.sendTyping();
        setTimeout(async function(){
            await message.channel.sendTyping();
        },9999)
        //await characterAI.authenticateWithToken(api);
        //const Rosemi = await characterAI.createOrContinueChat(persona);
    
        var input = '';
        if(message.author.id === process.env.ME_ID) {
            input += meFilter + message.content;
        } else {
            input += otherFilter + message.content;
        }
    
        var responses = await Rosemi.bot.sendAndAwaitResponse(input, false);
        message.reply(responses[0].text);
        }
}catch(err){
    console.log("(─‿‿─) I ran into a Character AI error: "+err)
}

}