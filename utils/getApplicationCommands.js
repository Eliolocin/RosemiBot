module.exports = async(client, guildId) => {
    let applicationCommands;


    applicationCommands = await client.application.commands;

    // Setting commands for only ONE server (in this case, the testServer)
    /*
    if(guildId){
        const guild = await client.guilds.fetch(guildId);
        applicationCommands = guild.commands;
    }   else {
        applicationCommands = await client.application.commands;
    }
    */


    await applicationCommands.fetch();
    return applicationCommands;
}