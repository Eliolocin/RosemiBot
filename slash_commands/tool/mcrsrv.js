const node = require('jspteroapi');
const axios = require('axios');
const WebSocket = require('ws');

module.exports = {
    name: 'mcserver',
    description: 'Commands for the Jack-O\'ff MC Server',
    // devOnly: Boolean,
    // testOnly: Boolean,
    // options: Object[],
    // deleted: Boolean,

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
                            interaction.editReply("**Minecraft Server restarted successfully!**\nPlease wait a few minutes before it is back online! (o゜▽゜)o☆");
                        }).catch(function (error) {
                            console.log(error);
                            interaction.editReply("**Minecraft Server restart was unsuccessful...** (─‿‿─)");
                        });
                    break;
                case 'status':
                    axios.get(`https://control.sparkedhost.us/api/client/servers/${srvID}/resources`, {
                        headers: {
                            'Accept': 'application/json',
                            'Content-Type': 'application/json',
                            'Authorization': 'Bearer ' + apiKey
                        }
                    }).then(function (response) {
                        const data=response.data.attributes.resources;
                        interaction.editReply(`Total Server Memory Used: **${((data.memory_bytes /= Math.pow(10, 9)).toFixed(2))} GB** / 12.00 GB`);
                      }).catch(function (error) {
                        console.log(error);
                      })


                      axios.get(`https://api.mcstatus.io/v2/status/java/${process.env.MC_IP}`)
                      .then(response => {
                          // Parse the JSON data
                          const playerList = response.data.players.list
                          const playerCount = playerList.length
                          interaction.channel.send(`Players Online: **${playerCount}** / 20`)
                        for(let i=0; i<playerCount; i++){
                            interaction.channel.send(`${i+1}. ${playerList[i].name_clean}`);
                        }
                      })
                      .catch(error => {
                          console.error('Failed to fetch player information:', error);
                      });
                    break;
            }






        }catch(err){
            console.log("(─‿‿─) I ran into a slash command error: "+err);
        }
}
};