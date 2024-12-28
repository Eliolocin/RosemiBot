const fs = require('fs');
const moment = require('moment');

module.exports = (client, oldVoiceState, newVoiceState) => {

    const joinMemID = newVoiceState.member.id
    //const jackOFF = client.guilds.cache.get(process.env.JACKO_ID)
    const JackOFF = client.guilds.cache.get(process.env.JACKO_ID);
    const Haven = client.guilds.cache.get(process.env.HAVEN_ID);
    const genCH = client.channels.cache.get(process.env.GENERAL_ID);
    const active = false;

    if( joinMemID === process.env.ME_ID && active ) {

        if ( oldVoiceState.channelId === newVoiceState.channelId ) return;
        else if ( !newVoiceState.channelId ) { // Leave channel
            const joinDate = JSON.parse(fs.readFileSync('resources/timer.json'));
            //const joinDate = new Date(oldData.joinTime);
            const leaveDate = moment().format("DD/MM/YYYY HH:mm:ss")

            var timeplayed = moment.utc(moment(leaveDate,"DD/MM/YYYY HH:mm:ss").diff(moment(joinDate.joinTime,"DD/MM/YYYY HH:mm:ss"))).format("HH:mm:ss")

            // PLAY SESSION LENGTH COUNTER!
            //genCH.send(`Papa, today\'s play session length was **${timeplayed}** long! (≧◡≦) ♡`)
            genCH.send(`*Papa, today\'s play session length was **${timeplayed}** long! (≧◡≦) ♡*`)

            /*
            if((Math.round(hours) === 2 && Math.round(minutes) >= 30) || Math.round(hours) > 2) // Overtime
            {
                genCH.send('Papa, you\'ve played for **' + 
                        Math.round(hours) + ' hours, ' +  
                        Math.round(minutes) + ' minutes, and ' + 
                        Math.round(seconds) + ' seconds** today! That\'s more than the 2 hours and 30 minutes you promised me! ( `ε´ )');
            } else {
                genCH.send('Papa, you\'ve played for **' + 
                        Math.round(hours) + ' hours, ' +  
                        Math.round(minutes) + ' minutes, and ' + 
                        Math.round(seconds) + ' seconds** today! (≧◡≦) ♡');
            }
            */

            

        }
        else if ( !oldVoiceState.channelId ) {
            const newData = { joinTime: moment().format("DD/MM/YYYY HH:mm:ss") }
            const newDatajson = JSON.stringify(newData)
            fs.writeFileSync('resources/timer.json', newDatajson);

                setTimeout(function () {
                    let kickCount = 0;
                    let hideCount = 0;
                    let mentionGroup = '';
                    
                    const voicedMembers = JackOFF.members.cache.filter(member => member.voice.channel);
                    for(const [memID, mem] of voicedMembers){
                        
                        if (memID === process.env.ME_ID && mem.voice.channelId !== process.env.DEPRIVE_ID){
                        kickCount++;
                        mem.voice.disconnect();
                        }
                        
                        if (memID === process.env.ME_ID && mem.voice.channelId === process.env.DEPRIVE_ID){
                            hideCount++;
                        }

                        if (mem.voice.channelId === newVoiceState.channelId && memID!==process.env.LOFI_ID && memID!== process.env.ME_ID){
                            mentionGroup += `<@${memID}> `;
                            //genCH.send(`<@${memID}>`) // Message everyone else in vc
                        }
                
                    }
                    const voicedHaven = Haven.members.cache.filter(member => member.voice.channel);
                    for(const [hemID, hem] of voicedHaven){
                        
                        if (hemID === process.env.ME_ID && hem.voice.channelId !== process.env.DEPRIVE_ID){
                        kickCount++;
                        hem.voice.disconnect();
                        }
                        
                        if (hemID === process.env.ME_ID && hem.voice.channelId === process.env.DEPRIVE_ID){
                            hideCount++;
                        }

                        if (hem.voice.channelId === newVoiceState.channelId && hemID!==process.env.LOFI_ID && hemID!== process.env.ME_ID){
                            mentionGroup += `<@${hemID}> `;
                            //genCH.send(`<@${memID}>`) // Message everyone else in vc
                        }
                
                    }

                    if (kickCount != 0 && mentionGroup.length > 1){
                        //genCH.send(mentionGroup) // Message everyone else in vc
                        //genCH.send(`<@${process.env.ME_ID}>! Papa! You've passed the 2 hour and 30 minute mark already! Say goodnight, it's time to go to sleep! ୧(๑•̀ᗝ•́)૭ `)
                        //genCH.send(`<@${process.env.ME_ID}> has already expended his daily 2 hours and 30 minutes play time! If he's still in-game with you, he'll wrap it up without rejoining the VC so I'll say "Good night" on his behalf... おやすみ、皆さん！ ♡ ～('▽^人)`)
                        genCH.send(`<@${process.env.ME_ID}>、寝ようよ！もう寝るの時間だよ！ ♡ ～('▽^人)`)
                        //genCH.send(`https://media1.tenor.com/m/Ux3GbjIh9HwAAAAC/rosemi-lovelock-rosemi.gif`)
                    }
                }, 9000000); // 2.5 hours


            /*
            let date1 = new Date('2024-01-17T21:28:53+08:00');
            let date2 = new Date('2024-01-18T00:00:00+08:00');

            let diffInMs = Math.abs(date2 - date1);
            let diffInHours = Math.floor(diffInMs / (1000 * 60 * 60));
            let diffInMinutes = Math.floor((diffInMs % (1000 * 60 * 60)) / (1000 * 60));

            console.log(`The difference between ${date1} and ${date2} is ${diffInHours} hours and ${diffInMinutes} minutes.`);
            */
        }



    }
};