const{ testServer } = require('../../resources/config.json');
const getApplicationCommands = require('../../utils/getApplicationCommands');
const getLocalCommands = require('../../utils/getLocalCommands');
const areCommandsDifferent = require('../../utils/areCommandsDifferent');

module.exports=async (client)=>{
    try{
        const localCommands = getLocalCommands();
        const applicationCommands = await getApplicationCommands(client, testServer);
        
        for (const localCommand of localCommands) {
            const {name, description, options} = localCommand;

            const existingCommand = await applicationCommands.cache.find(
                (cmd) => cmd.name === name
            );
            if(existingCommand){
                if(localCommand.deleted) {
                    await applicationCommands.delete(existingCommand.id);
                    console.log(`(Deleted command "${name}")`);
                    continue;
                }

            if(areCommandsDifferent(existingCommand,localCommand)){
                await applicationCommands.edit(existingCommand.id,{
                    description,
                    options,
                });
                //console.log(`(Edited command "${name}")`);
            }
            } else{
                if (localCommand.deleted){
                    console.log(`(Skipping registering command "${name}" as it's set to be deleted)`);
                    continue;
                }


                await applicationCommands.create({
                    name,
                    description,
                    options,
                })
                // const server = client.guilds.cache.get(testServer);
                console.log(`(Registered command "${name}")`);
            }
        }
    
    } catch(error){
        console.log(`(─‿‿─) There was a slash command registration error: ${error}`);
    }
};