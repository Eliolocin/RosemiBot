const {devs, testServer} = require('../../resources/config.json');
const getLocalCommands = require('../../utils/getLocalCommands');

module.exports = async (client, interaction) => {
    if(!interaction.isChatInputCommand()) return;

    const localCommands=getLocalCommands();

    try{
        const commandObject = localCommands.find(
            (cmd)=>cmd.name === interaction.commandName);

        if (!commandObject) return;

        if(commandObject.devOnly){
            //if(!devs.includes(interaction.member.id)){
            if(interaction.member.id != process.env.DEV_ID){
                interaction.reply({
                    content: 'Sorry, only developers are allowed to run this command!',
                    ephemeral: true,
                });
                return;
            }}
    
            if(commandObject.testOnly){
                if(!(interaction.guild.id === testServer)){
                    interaction.reply({
                        content: 'Sorry, this is a test command!',
                        ephemeral: true,
                    });
                    return;
                }}

            if(commandObject.permissionsRequired?.length){
                for(const permission of commandObject.permissionsRequired){
                    if(!interaction.member.permissions.has(permission)){
                        interaction.reply({
                            content: 'Not enough permissions!',
                            ephemeral: true,
                        });
                        return;
                    }
                }
            }

            if(commandObject.botPermissions?.length){
                for(const permission of commandObject.botPermissions){
                    const bot = interaction.guild.members.me;

                    if(!bot.permissions.has(permission)){
                        interaction.reply({
                            content: "I don't have enough permissions!",
                            ephemeral:true,
                        });
                    return;
                    }
                }
            }

            await commandObject.callback(client,interaction);

               }   catch(error){
        console.log(`(─‿‿─) There was an error running a command: ${error}`);
    }

};