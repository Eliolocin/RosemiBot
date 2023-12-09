var { Rosemi } = require('../ready/initCHRAI.js');
const CharacterAI = require('node_characterai');
const characterAI = new CharacterAI();
const api = process.env.CHRAI_API_KEY;
const persona = process.env.CHRAI_ROSEID;

module.exports = async (client, message) => {
 let active = false
    if(!active) return;
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
            message.reply("*My AI has been reinitialized successfully!*");
        }
    
    }
    
    else if((message.channel.id === process.env.GARDEN_ID || message.content.includes("ローゼミ")||/\brosemi\b/i.test(message.content)) && message.channel.id !== process.env.COMMANDS_ID && !message.author.bot && !message.content.startsWith('!') && !message.content.startsWith(':')) {
        if(Rosemi === undefined) {
            message.reply("*Rosemi seems to be busy with the Discord Server's paperwork at the moment, might as well let her be for now...*");
            return;
        }
        const userName = message.member.displayName;

        var date = new Date()
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

        var currentTime = `${hour}:${minutes} ${mid}`
        
        const meFilter =  `(OOC: The following message was sent by the owner of the Jack-O'ff Discord Server (your Boss). Address him as Sir Aso. Time right now is ${currentTime}.)\n`;
        const momFilter = `(OOC: The following message was sent by Mama! Time right now is ${currentTime}.)\n`;
        const otherFilter = `(OOC: The following message was sent by ${userName}. This person is NOT your Boss, he is simply a member of the Jack-O'ff Discord Server. Address this person as ${userName}, a member of the Jack-O'ff Discord Server. Time right now is ${currentTime}.)\n`;

             setTimeout( async () => {
                await message.channel.sendTyping();
              }, 1225);

        //await characterAI.authenticateWithToken(api);
        //const Rosemi = await characterAI.createOrContinueChat(persona);
    
        var input = '';
        if(message.author.id === process.env.ME_ID) {
            input += meFilter + message.content;
        } else if(message.author.id === process.env.BRED_ID)  {
            input += momFilter + message.content;
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