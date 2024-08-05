const path = require('path');
const getAllFiles = require('../utils/getAllFiles');


module.exports = (client) => {

     const eventFolders = getAllFiles(path.join(__dirname, '..', 'events'), true);

     for (const eventFolder of eventFolders){
        const eventFiles = getAllFiles(eventFolder);
        eventFiles.sort((a,b) => a>b); // Sorts event files in order
        
        const eventName = eventFolder.replace(/\\/g, '/').split('/').pop()
        
        if(eventName === "voiceStateUpdate" || eventName === "presenceUpdate"){
            client.on(eventName, async(arg1, arg2)  =>{
                for(const eventFile of eventFiles){
                    const eventFunction = require(eventFile);
                    await eventFunction(client, arg1, arg2)
                }
            });
        }

        else{
        client.on(eventName, async(arg) =>{
            for(const eventFile of eventFiles){
                const eventFunction = require(eventFile);
                await eventFunction(client, arg)
            }
        });
    }
    }
};