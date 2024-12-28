const fs = require('fs');

module.exports = (client, oldGame, newGame) => {

    const enabled = false;
    if(!enabled) return;
    
    try{
        const presenceMemID = newGame.member.id
        const presenceGID = newGame.guild.id
        const JackOFF = client.guilds.cache.get(process.env.JACKO_ID);
        const Haven = client.guilds.cache.get(process.env.HAVEN_ID);
        const genCH = client.channels.cache.get(process.env.GENERAL_ID);
    
        if( presenceMemID === process.env.ME_ID && presenceGID == process.env.JACKO_ID) 
        {
            let newCount = 0;
            for (let activity of newGame.activities)
            {
                    if(activity.state == "ゲーム中") return;
            }
            for (let activity of oldGame.activities)
                {
                    //console.log(activity);
                    if(activity.state == "ゲーム中")
                        {
                            const data = JSON.parse(fs.readFileSync('resources/gameCount.json'));
                            newCount = data.gamesPlayed+1
                            if(newCount >= 4) newCount = 0; // 4 Games
                            const newData = { gamesPlayed: newCount };
                            const newJsonData = JSON.stringify(newData);
                            fs.writeFileSync('resources/gameCount.json', newJsonData);
    
                            if(newCount === 0)
                            {
    
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
    
                                    if (memID!== process.env.LOFI_ID && memID!== process.env.ME_ID){
                                        mentionGroup += `<@${memID}> `;
                                        //genCH.send(`<@${memID}>`) // Message everyone else in vc
                                    }
                            
                                }
    
                                if (kickCount != 0 && mentionGroup.length > 1){
                                    genCH.send(mentionGroup) // Message everyone else in vc
                                    genCH.send(`<@${process.env.ME_ID}> has finished playing his daily 4 games! 寝ようよ！もう寝るの時間だよ！ ♡ ～('▽^人)`)
                                }
                            }
                        }
                        
                }
    
        }
    }catch(err){
        
        console.log(err)
    }
    
};