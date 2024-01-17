const fs = require('fs');

module.exports = (client, oldVoiceState, newVoiceState) => {

    const joinMemID = newVoiceState.member.id
    //const jackOFF = client.guilds.cache.get(process.env.JACKO_ID)
    const genCH = client.channels.cache.get(process.env.GENERAL_ID);

    if( joinMemID === process.env.ME_ID ) {
        
        if ( oldVoiceState.channelId === newVoiceState.channelId ) return;
        else if ( !newVoiceState.channelId ) { // Leave channel
            const oldData = JSON.parse(fs.readFileSync('timer.json'));
            const joinDate = new Date(oldData.joinTime);
            const leaveDate = new Date();

            var diff = leaveDate - joinDate;

            var hours = Math.floor(diff / 3.6e5);
            var minutes = (Math.floor(diff % 3.6e5) / 6e4);
            var seconds = Math.floor(diff % 6e4) / 1000;

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

            

        }
        else if ( !oldVoiceState.channelId ) { // Join channel

            const newData = { joinTime: new Date() }
            const newDatajson = JSON.stringify(newData)
            fs.writeFileSync('timer.json', newDatajson);

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