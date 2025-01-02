const node = require('jspteroapi');
const axios = require('axios');
const WebSocket = require('ws');
const {EmbedBuilder, ApplicationCommandOptionType,ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType} = require('discord.js');

module.exports = {
    name: 'mcserver',
    description: 'Commands for the Jack-O\'ff MC Server',
    // devOnly: Boolean,
    // testOnly: Boolean,
    // options: Object[],
    deleted: true,

    options:
    [
        {
            name:'restart',
            description:'Restart the MC Server',
            type: 1, // Type 1 for subcommand
        },
        {
            name:'status',
            description:'Status of the MC Server',
            type: 1, // Type 1 for subcommand
        },
    ],

    callback: async (client, interaction) =>{
        var restartErrorEmbed = new EmbedBuilder()
            .setColor('#FF0000')
            .setDescription('**Minecraft Server restart was unsuccessful...** (─‿‿─)')

        var restartSuccessEmbed = new EmbedBuilder()
            .setColor('#00FF00')
            .setDescription('**Minecraft Server restarted successfully!**\nPlease wait a few minutes before it gets back online! (o゜▽゜)o☆')

        try{

            
            const apiKey = process.env.MC_API;
            const srvID = process.env.MC_ID;
            const mcserver = interaction.options.getSubcommand();
            await interaction.deferReply();

            switch(mcserver)
            {
                
                case 'restart':
                    axios.post(`https://control.sparkedhost.us/api/client/servers/${srvID}/power`, 
                        {
                            "signal": "restart"
                        }, 
                        {
                            headers: {
                                'Accept': 'application/json',
                                'Content-Type': 'application/json',
                                'Authorization': 'Bearer ' + apiKey
                            }
                        }).then(function (response) {
                            //console.log("Server stopping...");
                            console.log(response.data);
    


                            interaction.editReply({embeds:[restartSuccessEmbed]});
                        }).catch(function (error) {
                            console.log(error);
                            interaction.editReply({embeds:[restartErrorEmbed]});
                        });
                    break;
                case 'status':
                    var dataUsed = 0;
                    var statusString = "";

                    await axios.get(`https://control.sparkedhost.us/api/client/servers/${srvID}/resources`, {
                        headers: {
                            'Accept': 'application/json',
                            'Content-Type': 'application/json',
                            'Authorization': 'Bearer ' + apiKey
                        }
                    }).then(function (response) {
                        const data=response.data.attributes.resources;
                        dataUsed = ((data.memory_bytes /= Math.pow(10, 9)).toFixed(2));
                        
                      }).catch(function (error) {
                        console.log(error);
                      })

                    await axios.get(`https://api.mcstatus.io/v2/status/java/${process.env.MC_IP}`)
                      .then(response => {
                          // Parse the JSON data
                          const playerList = response.data.players.list
                          const playerCount = playerList.length

                          statusString=`Players Online: **${playerCount}** / 20`;
                        for(let i=0; i<playerCount; i++){
                            statusString+=`\n${i+1}. ${playerList[i].name_clean}`
                        }
                        
                      })
                      .catch(error => {
                          console.error('Failed to fetch player information:', error);
                      });
                    
                      var serverStatusEmbed = new EmbedBuilder()
                        .setColor('#40e0d0')
                        .setDescription(`Total Server Memory Used: **${dataUsed} GB** / 12.00 GB\n`+statusString)
                      interaction.editReply({embeds:[serverStatusEmbed]});
                      
                    break;
            }






        }catch(err){
            console.log("(─‿‿─) I ran into a slash command error: "+err);
        }
}
};