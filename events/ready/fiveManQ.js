const schedule = require('node-schedule');

module.exports = (client) => {

    active = false;

    if(active){

        const JackOFF = client.guilds.cache.get(process.env.JACKO_ID)
        const genCH = client.channels.cache.get(process.env.GENERAL_ID)


        const rule = new schedule.RecurrenceRule();
        rule.hour = 10;     // -4, then it is PH time 9:30 as of now
        rule.minute = 0;   // 13:30
        rule.tz = 'Etc/UTC';

        const job = schedule.scheduleJob(rule, async function(){
            genCH.send("**Click on the Emoji below if you are G for a 5-person Gaming Session!**\nOnce there has been **5** reacts total *(6 including mine)*, I shall notify you.")
                .then(message => message.react('⭕'));

            
        });

    }



};