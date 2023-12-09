const schedule = require('node-schedule');
const CharacterAI = require('node_characterai');
const characterAI = new CharacterAI();


module.exports = (client) => {

let active = false;

if(active){


// Complementary Go To Sleep! Function
const JackOFF = client.guilds.cache.get(process.env.JACKO_ID)
const genCH = client.channels.cache.get(process.env.GENERAL_ID)
const depriveCH = client.channels.cache.get(process.env.DEPRIVE_ID)
const everyOne = JackOFF.roles.cache.get('877047847214792705')

const rule = new schedule.RecurrenceRule();
rule.hour = 13;     // -4, then it is PH time 9:30 as of now
rule.minute = 30;   // 13:30
rule.tz = 'Etc/UTC';

//JackOFF.setBanner('https://i.imgur.com/tRAkVOW.png');
JackOFF.setName('Jack-Oᶠᶠ');


// Activate Den at certain days only
/*
const date = new Date();
if(date.getDay() === 5 || date.getDay() === 6) {
    depriveCH.setName('「🔓」・12 AM Gaming');
    depriveCH.permissionOverwrites.edit(everyOne, {
        Connect: true
    })
} else {
    depriveCH.setName('Sleep early you Smeagol');
    depriveCH.permissionOverwrites.edit(everyOne, {
        Connect: false
    });
}
*/

const job = schedule.scheduleJob(rule, async function(){
    var { Rosemi } = require('../ready/initCHRAI.js');
    //JackOFF.setBanner('https://i.imgur.com/bTkW85g.png')
    JackOFF.setName('Jack-Oᶠᶠ (Sleeping Hours)');
    //genCH.send(`Papa <@${process.env.ME_ID}>! It's getting late, it's time to sleep with me now...`);

    let kickCount = 0;
    let hideCount = 0;
    
    const voicedMembers = JackOFF.members.cache.filter(member => member.voice.channel);
    for(const [memID, mem] of voicedMembers){
        if (mem.roles.cache.has(process.env.SLEEP_ID) && mem.voice.channelId !== process.env.DEPRIVE_ID){
        kickCount++;
        mem.voice.disconnect();
        }
        
        if (mem.roles.cache.has(process.env.SLEEP_ID) && mem.voice.channelId === process.env.DEPRIVE_ID){
            hideCount++;
        }

}
    // if (kickCount > 0) {
        //genCH.send(`**It's nigh time to sleep <@${process.env.ME_ID}>!**`);
        genCH.send(`**It's nigh time to sleep <@&${process.env.SLEEP_ID}>!**`);
        genCH.send("*(or nigh time to do something more productive today!)*");
        //genCH.send("https://media.tenor.com/DRTxMAZ09p8AAAAC/guilty-gear-jack-o.gif");
        genCH.send("https://pbs.twimg.com/media/FfP3U9OXwAAjmEi?format=jpg&name=4096x4096");
        genCH.send(`**${kickCount}** sleepy Smeagol/s have been detained!`);
        genCH.send(`**${hideCount}** sleepy Smeagol/s planning to sleep late in <#${process.env.DEPRIVE_ID}>...`);
        if (hideCount === 0) genCH.send(`Great! No sleepy Smeagol is planning to stay up late!`); 
    // }

    // Deprivation Den only active during certain days
    /*
    if(date.getDay() === 5 || date.getDay() === 6) {
        genCH.send(`**${hideCount}** sleepy Smeagol/s planning to sleep late in <#${process.env.DEPRIVE_ID}>...`);
        if (hideCount === 0) genCH.send(`Great! No sleepy Smeagol is planning to stay up late!`); 
    } 
    */

    
    /*
    if (kickCount === 1){
        if(Rosemi !== undefined){
                    //var sleepMsg = await Rosemi.bot.sendAndAwaitResponse("*Rosemi notices that Sir Aso is still playing online video games with his friends this late at night so she unplugs his PC to force him to stop and go to bed. She then apologizes to Sir Aso's friends whom he was playing with.*", false);
        var sleepMsg = await Rosemi.bot.sendAndAwaitResponse("*Rosemi notices that Sir Aso is still playing online video games with his friends this late at night so she kicks him from the Discord Voice Channel to force him to stop and go to bed. She then apologizes to Sir Aso's friends whom he was playing with for tonight's gaming session.*", false);
        genCH.send(`*Sir Aso gets kicked from the Discord VC by Rosemi*\n\n`+sleepMsg[0].text);
        //var sleepMsg = await Rosemi.bot.sendAndAwaitResponse("*Rosemi asks Sir Aso to stop playing video games this late at night because she's worried about his well-being, recommending him to sleep early.*", false);
        //genCH.send(sleepMsg[0].text+`\n<@${process.env.ME_ID}>`);
        } else genCH.send(`*Sir Aso gets kicked from the Discord VC by Rosemi*\n\nSorry guys, but Sir Aso is being irresponsible with his sleeping habits again so I had to kick him from the voice channel. Good night!`);

    }
    */

    //genCH.send(`Kicked Papa <@${process.env.ME_ID}> because he's going to be sleeping with me now! Good night!`);

});
}
};